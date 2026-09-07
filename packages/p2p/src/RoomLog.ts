import { Effect, Option, Queue, Schema, Stream } from "effect";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import { LogOp, type Member, type RoomMessage } from "./schema";
import { mergeTicket, type Ticket } from "./ticket";

/** The room as derived from its log. Read whole — rooms are small. */
export interface LogView {
  readonly tickets: ReadonlyArray<Ticket>;
  readonly name: { readonly name: string; readonly ts: number } | null;
  readonly members: ReadonlyArray<Member>;
  /** Every message in the room, in log order, with its position. */
  readonly messages: ReadonlyArray<{ readonly seq: number; readonly msg: RoomMessage }>;
}

export interface RoomLog {
  /** The log's key: what a joiner needs to open it (travels in the greet). */
  readonly key: string;
  /** Our writer core's key: what a member appends to admit us. */
  readonly writerKey: string;
  readonly writable: () => boolean;
  /** Fails with "Not writable" until admitted. Resolves once the view reflects the entry. */
  readonly append: (op: LogOp) => Effect.Effect<void, Error>;
  readonly read: Effect.Effect<LogView>;
  /** Fires after the view changed or our writer status did. */
  readonly changes: Stream.Stream<void>;
}

const decodeOp = Schema.decodeUnknownOption(LogOp);
const MSG_KEY = (seq: number) => `msg/${String(seq).padStart(12, "0")}`;

/** The one place log entries become room state. Runs on every member with
 *  the same inputs in the same order, so it must be a pure function of
 *  (view, entries): reads and writes the Hyperbee view, nothing else.
 *  Malformed entries are skipped — a bad writer can't wedge the room. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apply(nodes: ReadonlyArray<{ value: unknown }>, view: any, host: any): Promise<void> {
  for (const node of nodes) {
    const op = Option.getOrUndefined(decodeOp(node.value));
    if (!op) continue;
    switch (op.op) {
      case "add-writer":
        await host.addWriter(b4a.from(op.key, "hex"), { indexer: true });
        break;
      case "member": {
        const cur = await view.get(`member/${op.key}`);
        if (!cur || op.ts >= cur.value.ts) await view.put(`member/${op.key}`, { key: op.key, name: op.name, ts: op.ts });
        break;
      }
      case "ticket": {
        const cur = await view.get(`ticket/${op.ticket.id}`);
        await view.put(`ticket/${op.ticket.id}`, cur ? mergeTicket(cur.value as Ticket, op.ticket) : op.ticket);
        break;
      }
      case "rename": {
        const cur = await view.get("meta/name");
        if (!cur || op.ts > cur.value.ts) await view.put("meta/name", { name: op.name, ts: op.ts });
        break;
      }
      case "msg": {
        const count = (await view.get("state/msgs"))?.value ?? 0;
        await view.put(MSG_KEY(count), op.msg);
        await view.put("state/msgs", count + 1);
        break;
      }
    }
  }
}

/** Open (or create, when `bootstrap` is null) a room's Autobase in the given
 *  Corestore namespace. Scoped: closes with the scope. */
export const openRoomLog = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  bootstrap: string | null,
): Effect.Effect<RoomLog, never, import("effect").Scope.Scope> =>
  Effect.gen(function* () {
    const base = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const b = new Autobase(store, bootstrap ? b4a.from(bootstrap, "hex") : null, {
          valueEncoding: "json",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          open: (viewStore: any) =>
            new Hyperbee(viewStore.get("view"), { keyEncoding: "utf-8", valueEncoding: "json", extension: false }),
          apply,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          close: (view: any) => view.close(),
        });
        await b.ready();
        return b;
      }),
      (b) => Effect.promise(() => b.close() as Promise<void>).pipe(Effect.ignore),
    );

    const readRange = (prefix: string) =>
      Effect.promise(async () => {
        const out: Array<{ key: string; value: unknown }> = [];
        for await (const entry of base.view.createReadStream({ gte: `${prefix}/`, lt: `${prefix}0` })) out.push(entry);
        return out;
      });

    const read: Effect.Effect<LogView> = Effect.gen(function* () {
      const tickets = (yield* readRange("ticket")).map((e) => e.value as Ticket);
      const members = (yield* readRange("member")).map((e) => e.value as Member);
      const messages = (yield* readRange("msg")).map((e) => ({
        seq: Number(e.key.slice("msg/".length)),
        msg: e.value as RoomMessage,
      }));
      const name = yield* Effect.promise(() => base.view.get("meta/name") as Promise<{ value: { name: string; ts: number } } | null>);
      return { tickets, members, messages, name: name?.value ?? null };
    });

    const changes = Stream.callback<void>((queue) =>
      Effect.gen(function* () {
        const fire = () => void Queue.offerUnsafe(queue, undefined);
        base.on("update", fire);
        base.on("writable", fire);
        base.on("unwritable", fire);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            base.off("update", fire);
            base.off("writable", fire);
            base.off("unwritable", fire);
          }),
        );
      }),
    );

    const append = (op: LogOp) =>
      Effect.tryPromise({
        try: async () => {
          await base.append(op);
          await base.update();
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

    return {
      key: b4a.toString(base.key, "hex"),
      writerKey: b4a.toString(base.local.key, "hex"),
      writable: () => base.writable as boolean,
      append,
      read,
      changes,
    };
  });
