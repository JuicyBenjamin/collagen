import { Effect, Option, Queue, Schema, Stream } from "effect";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import { LogAppendFailed } from "./errors";
import { DeviceEntry } from "./devices";
import type { LogEncryption } from "./RoomLog";

// A person's own log: written and read only by their devices, encrypted. It
// is where the acts about their devices live (devices.ts), and the rooms they
// are in with each room's keys — so a room entered on one device opens on the
// others, a device that was off included: it catches up when it next meets
// any of the rest.

/** A room the person is in, as their devices need it to open it. */
export const PersonRoom = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** the room's log and the key that reads it, once the person was let in */
  logKey: Schema.optional(Schema.String),
  encryptionKey: Schema.optional(Schema.String),
});
export type PersonRoom = typeof PersonRoom.Type;

export const PersonOp = Schema.Union([
  /** another of the person's devices let in to write */
  Schema.Struct({ op: Schema.Literal("add-writer"), key: Schema.String }),
  /** an act about the person's devices */
  Schema.Struct({ op: Schema.Literal("device"), entry: DeviceEntry }),
  /** a room entered, or what is known of it now (its keys, its name) */
  Schema.Struct({ op: Schema.Literal("room"), room: PersonRoom }),
  /** a room left */
  Schema.Struct({ op: Schema.Literal("leave"), id: Schema.String }),
]);
export type PersonOp = typeof PersonOp.Type;

/** The person as derived from their log. */
export interface PersonView {
  /** the acts about their devices, in log order (foldDevices reads them) */
  readonly devices: ReadonlyArray<DeviceEntry>;
  /** the rooms they are in now */
  readonly rooms: ReadonlyArray<PersonRoom>;
}

export interface PersonLog {
  /** What another device needs to open it, with the key that reads it. */
  readonly key: string;
  readonly encryptionKey: string;
  /** This device's writer core: what a device already in adds to let this one write. */
  readonly writerKey: string;
  readonly writable: () => boolean;
  readonly append: (op: PersonOp) => Effect.Effect<void, LogAppendFailed>;
  readonly read: Effect.Effect<PersonView>;
  /** Fires after the view changed or our writer status did. */
  readonly changes: Stream.Stream<void>;
}

const decodeOp = Schema.decodeUnknownOption(PersonOp);
/** Rows in log order under one prefix: a counter, padded so keys sort as numbers. */
const position = (count: number) => String(count).padStart(12, "0");

/** The one place entries become the person's state: the same on every device,
 *  in the same order. What cannot be read is skipped. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apply(nodes: ReadonlyArray<{ value: unknown }>, view: any, host: any): Promise<void> {
  for (const node of nodes) {
    const personOp = Option.getOrUndefined(decodeOp(node.value));
    if (!personOp) continue;
    switch (personOp.op) {
      case "add-writer":
        await host.addWriter(b4a.from(personOp.key, "hex"), { indexer: true });
        break;
      case "device": {
        // once, by id, at the place it first came
        if (await view.get(`device-id/${personOp.entry.id}`)) break;
        const count = ((await view.get("state/devices"))?.value ?? 0) as number;
        await view.put(`device-id/${personOp.entry.id}`, count);
        await view.put(`device/${position(count)}`, personOp.entry);
        await view.put("state/devices", count + 1);
        break;
      }
      // the last said in the log stands — one order on every device, no clock asked
      case "room":
        await view.put(`room/${personOp.room.id}`, personOp.room);
        break;
      case "leave":
        await view.del(`room/${personOp.id}`);
        break;
    }
  }
}

/** How long an append waits for our own view to follow before carrying on (RoomLog says why). */
const UPDATE_PATIENCE = "5 seconds";

/** Open (or make, when `bootstrap` is null) a person's log in this device's
 *  Corestore. Scoped: closes with the scope. `wakeup` is the swarm's
 *  (Swarm.wakeup): without it the other devices never hear this one wrote. */
export const openPersonLog = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  person: string,
  bootstrap: string | null,
  /** a new log makes its key; one that exists is read with the key its devices hold */
  encryption: Exclude<LogEncryption, "none">,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wakeup?: any,
): Effect.Effect<PersonLog, never, import("effect").Scope.Scope> =>
  Effect.gen(function* () {
    const base = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const autobase = new Autobase(store.namespace(`person/${person}`), bootstrap ? b4a.from(bootstrap, "hex") : null, {
          valueEncoding: "json",
          ...(wakeup ? { wakeup } : {}),
          ...(encryption === "new" ? { encrypt: true } : { encryptionKey: b4a.from(encryption.key, "hex") }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          open: (viewStore: any) => new Hyperbee(viewStore.get("view"), { keyEncoding: "utf-8", valueEncoding: "json", extension: false }),
          apply,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          close: (view: any) => view.close(),
        });
        await autobase.ready();
        return autobase;
      }),
      (autobase) => Effect.promise(() => autobase.close() as Promise<void>).pipe(Effect.ignore),
    );

    const rows = <A, E>(prefix: string, schema: Schema.Codec<A, E>) =>
      Effect.promise(async () => {
        const out: Array<A> = [];
        for await (const entry of base.view.createReadStream({ gte: `${prefix}/`, lt: `${prefix}0` })) {
          const decoded = Schema.decodeUnknownOption(schema)(entry.value);
          if (Option.isSome(decoded)) out.push(decoded.value);
        }
        return out;
      });

    const read: Effect.Effect<PersonView> = Effect.gen(function* () {
      return { devices: yield* rows("device", DeviceEntry), rooms: yield* rows("room", PersonRoom) };
    });

    const changes = Stream.callback<void>((queue) =>
      Effect.gen(function* () {
        const fire = () => void Queue.offerUnsafe(queue, undefined);
        for (const event of ["update", "writable", "unwritable"]) base.on(event, fire);
        yield* Effect.addFinalizer(() => Effect.sync(() => { for (const event of ["update", "writable", "unwritable"]) base.off(event, fire); }));
      }),
    );

    const append = (personOp: PersonOp) =>
      Effect.tryPromise({ try: () => base.append(personOp) as Promise<void>, catch: (cause) => new LogAppendFailed({ cause }) }).pipe(
        Effect.andThen(
          Effect.tryPromise({ try: () => base.update() as Promise<void>, catch: (cause) => new LogAppendFailed({ cause }) }).pipe(Effect.timeoutOption(UPDATE_PATIENCE), Effect.asVoid),
        ),
      );

    return {
      key: b4a.toString(base.key, "hex"),
      encryptionKey: b4a.toString(base.encryptionKey, "hex"),
      writerKey: b4a.toString(base.local.key, "hex"),
      writable: () => base.writable as boolean,
      append,
      read,
      changes,
    };
  });
