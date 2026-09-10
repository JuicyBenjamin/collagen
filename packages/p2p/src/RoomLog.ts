import { Clock, Effect, Option, Queue, Schema, Stream } from "effect";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import { LogAppendFailed } from "./errors";
import { Attachment, EVICTABLE, LogOp, Member, PROTOCOL_VERSION, RoomMessage } from "./schema";
import { ReviewContext } from "./review";
import { mergeTicket, Ticket } from "./ticket";

/** The room as derived from its log. Read whole — rooms are small. */
export interface LogView {
  readonly tickets: ReadonlyArray<Ticket>;
  readonly name: { readonly name: string; readonly ts: number } | null;
  readonly members: ReadonlyArray<Member>;
  /** Every message in the room, in log order, with its position. */
  readonly messages: ReadonlyArray<{ readonly seq: number; readonly msg: RoomMessage }>;
  /** Transcripts attached to tickets — references; the files stay with their holders. */
  readonly attachments: ReadonlyArray<Attachment>;
  /** The why behind each review ticket, one per ticket. */
  readonly reviews: ReadonlyArray<ReviewContext>;
}

export interface RoomLog {
  /** The log's key: what a joiner needs to open it (travels in the greet). */
  readonly key: string;
  /** Our writer core's key: what a member appends to admit us. */
  readonly writerKey: string;
  readonly writable: () => boolean;
  /** Fails (LogAppendFailed, "Not writable") until admitted. Resolves once the view reflects the entry. */
  readonly append: (op: LogOp) => Effect.Effect<void, LogAppendFailed>;
  readonly read: Effect.Effect<LogView>;
  /** Take the rows no build of ours can read off the room, for every member
   *  (one `evict` entry on the log). Returns how many went. */
  readonly evictStale: Effect.Effect<number>;
  /** Fires after the view changed or our writer status did. */
  readonly changes: Stream.Stream<void>;
}

const decodeOp = Schema.decodeUnknownOption(LogOp);
const MSG_KEY = (seq: number) => `msg/${String(seq).padStart(12, "0")}`;

/** The view key an entry we CANNOT read would have written, when the entry is
 *  still shaped enough to say. One protocol version at a time: an entry from
 *  a build that speaks another one is not accommodated, and it does not get
 *  to sit in the room half-applied either — the row it claims is deleted, so
 *  the record is gone rather than stale. */
const claimedKey = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const field = (x: unknown, k: string): string | null => {
    const got = typeof x === "object" && x !== null ? (x as Record<string, unknown>)[k] : undefined;
    return typeof got === "string" ? got : null;
  };
  if (v.op === "ticket") {
    const id = field(v.ticket, "id");
    return id ? `ticket/${id}` : null;
  }
  if (v.op === "review") {
    const id = field(v.review, "ticketId");
    return id ? `review/${id}` : null;
  }
  if (v.op === "attachment") {
    const ticketId = field(v.attachment, "ticketId");
    const id = field(v.attachment, "id");
    return ticketId && id ? `attachment/${ticketId}/${id}` : null;
  }
  return null;
};

/** The one place log entries become room state. Runs on every member with
 *  the same inputs in the same order, so it must be a pure function of
 *  (view, entries): reads and writes the Hyperbee view, nothing else.
 *  Malformed entries are skipped — a bad writer can't wedge the room. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apply(nodes: ReadonlyArray<{ value: unknown }>, view: any, host: any): Promise<void> {
  for (const node of nodes) {
    const op = Option.getOrUndefined(decodeOp(node.value));
    if (!op) {
      // unreadable here: eject the row it claims instead of leaving a stale one
      const key = claimedKey(node.value);
      if (key) await view.del(key);
      continue;
    }
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
      case "attachment": {
        // first write wins: an attachment is a fact about a file someone holds
        const cur = await view.get(`attachment/${op.attachment.ticketId}/${op.attachment.id}`);
        if (!cur) await view.put(`attachment/${op.attachment.ticketId}/${op.attachment.id}`, op.attachment);
        break;
      }
      case "review": {
        // one review per ticket, written by its author alone: later ts wins
        const cur = await view.get(`review/${op.review.ticketId}`);
        if (!cur || op.review.ts >= (cur.value as ReviewContext).ts) await view.put(`review/${op.review.ticketId}`, op.review);
        break;
      }
      case "evict":
        // the migration, replayed on every member: drop what it names
        for (const key of op.keys) if (EVICTABLE.test(key)) await view.del(key);
        break;
      default: {
        // a LogOp with no case here is a COMPILE error: an entry every member
        // silently ignores is the worst kind of nothing
        const unhandled: never = op;
        void unhandled;
        break;
      }
    }
  }
}

/** Where in the Corestore a room's log lives. The room's own namespace holds
 *  the writer core we made for it; if that core already belongs to ANOTHER
 *  base (we started a log of our own before adopting the room's), the adopted
 *  log gets a namespace of its own — reusing a writer core across bases
 *  corrupts both. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const namespaceFor = async (store: any, roomName: string, bootstrap: string | null): Promise<any> => {
  const primary = store.namespace(roomName);
  if (bootstrap === null) return primary;
  const local = Autobase.getLocalCore(primary, {});
  await local.ready();
  const { referrer } = await Autobase.getUserData(local);
  await local.close();
  const ours = referrer === null || referrer === undefined || b4a.equals(referrer, b4a.from(bootstrap, "hex"));
  return ours ? primary : store.namespace(`${roomName}/${bootstrap}`);
};

/** Open (or create, when `bootstrap` is null) a room's Autobase in the
 *  identity's Corestore. Scoped: closes with the scope. */
export const openRoomLog = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  roomName: string,
  bootstrap: string | null,
): Effect.Effect<RoomLog, never, import("effect").Scope.Scope> =>
  Effect.gen(function* () {
    const base = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const ns = await namespaceFor(store, roomName, bootstrap);
        const b = new Autobase(ns, bootstrap ? b4a.from(bootstrap, "hex") : null, {
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

    // The view is never trusted on its shape: a row written by a build that
    // spoke another protocol version can never reach the app. Reading notes
    // those rows; `evictStale` then takes them off the room for everyone.
    let stale: ReadonlyArray<string> = [];
    let announced = -1;
    const read: Effect.Effect<LogView> = Effect.gen(function* () {
      const bad: string[] = [];
      const rows = <A, E>(prefix: string, schema: Schema.Codec<A, E>) =>
        readRange(prefix).pipe(
          Effect.map((entries) =>
            entries.flatMap((e) => {
              const decoded = Schema.decodeUnknownOption(schema)(e.value);
              if (Option.isNone(decoded)) {
                if (EVICTABLE.test(e.key)) bad.push(e.key);
                return [];
              }
              return [{ key: e.key, value: decoded.value }];
            }),
          ),
        );
      const tickets = (yield* rows("ticket", Ticket)).map((e) => e.value);
      const members = (yield* rows("member", Member)).map((e) => e.value);
      const messages = (yield* rows("msg", RoomMessage)).map((e) => ({ seq: Number(e.key.slice("msg/".length)), msg: e.value }));
      const attachments = (yield* rows("attachment", Attachment)).map((e) => e.value);
      const reviews = (yield* rows("review", ReviewContext)).map((e) => e.value);
      const name = yield* Effect.promise(() => base.view.get("meta/name") as Promise<{ value: { name: string; ts: number } } | null>);
      stale = bad;
      if (bad.length !== announced) {
        announced = bad.length;
        if (bad.length > 0) {
          yield* Effect.logWarning(
            `${bad.length} record(s) in this room were written by a build speaking another protocol version (ours: ${PROTOCOL_VERSION}) — kept out of the room and queued for eviction`,
          );
        }
      }
      return { tickets, members, messages, attachments, reviews, name: name?.value ?? null };
    });

    /** The migration: take the rows nobody can read off the room, for every
     *  member, by recording it on the log. Needs write access (a joiner does
     *  it once admitted); idempotent — evicting a gone row is a no-op. */
    const evictStale = Effect.gen(function* () {
      const keys = stale;
      if (keys.length === 0 || !base.writable) return 0;
      const ts = yield* Clock.currentTimeMillis;
      const ok = yield* append({ op: "evict", keys, protocol: PROTOCOL_VERSION, reason: `unreadable by protocol ${PROTOCOL_VERSION}`, ts }).pipe(
        Effect.as(true),
        Effect.catch((e) => Effect.logWarning(`eviction failed: ${e.message}`).pipe(Effect.as(false))),
      );
      if (!ok) return 0;
      stale = [];
      yield* Effect.log(`evicted ${keys.length} record(s) from an older protocol version: ${keys.join(", ")}`);
      return keys.length;
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
        catch: (cause) => new LogAppendFailed({ cause }),
      });

    return {
      key: b4a.toString(base.key, "hex"),
      writerKey: b4a.toString(base.local.key, "hex"),
      writable: () => base.writable as boolean,
      append,
      read,
      evictStale,
      changes,
    };
  });
