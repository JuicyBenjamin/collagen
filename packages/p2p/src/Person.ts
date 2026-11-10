import { createHash, randomUUID } from "node:crypto";
import { Clock, Context, Effect, Exit, Schedule, Scope, Stream, SubscriptionRef } from "effect";
import b4a from "b4a";
import { devicesOf, foldDevices, NO_DEVICES, personOf, signConsent, signDevice, type DeviceAct, type DeviceEntry, type Devices } from "./devices";
import { openSealed, sealFor } from "./invite";
import { openPersonLog, type PersonLog, type PersonRoom } from "./PersonLog";
import type { LogEncryption } from "./RoomLog";
import type { Frame } from "./schema";
import { Swarm, type TopicHooks } from "./Swarm";
import type { Net } from "./topic";

// One person on several devices. Two devices become one person by a
// handshake both sides must be told to make: the parent shares its identity
// with a named peer, that peer takes the identity of the named parent. One
// side alone does nothing. From then on they share the person's own log
// (PersonLog): the acts about their devices, and their rooms.

/** What a device keeps on disk to open its person's log again. */
export interface PersonStored {
  /** the key the person is known by */
  readonly person: string;
  readonly logKey: string;
  readonly encryptionKey: string;
}

export class PersonConfig extends Context.Service<PersonConfig, {
  readonly net: Net;
  /** what was kept from before; null for a device that is its own person, alone */
  readonly stored: PersonStored | null;
  readonly save: (stored: PersonStored) => Effect.Effect<void>;
  /** what this device is called when it is taken in, until someone names it */
  readonly deviceName: string;
}>()("p2p/PersonConfig") {}

/** The person this device is, and their devices, as the acts stand. */
export interface PersonState {
  readonly person: string;
  /** this device */
  readonly device: string;
  readonly parent: string;
  readonly devices: ReadonlyArray<{ readonly key: string; readonly name: string }>;
  readonly rooms: ReadonlyArray<PersonRoom>;
}

/** Why an act about devices was not made. */
export type PersonRefusal = "not-parent" | "not-a-device" | "already-linked" | "is-parent" | "not-writable";

/** How long a share or a take waits for the other side to be told. */
export const HANDSHAKE_PATIENCE_MS = 5 * 60_000;

/** Where two connected peers talk about identity: listened on, never announced. */
const IDENTITY_TOPIC = createHash("sha256").update("collagen-identity").digest("hex");
/** Where a person's devices find each other: only they know the log's key. */
const personTopic = (logKey: string, net: Net): Buffer => createHash("sha256").update(`${net === "devnet" ? "collagen-devnet" : "collagen"}:person:${logKey}`).digest();

export const makePerson = Effect.gen(function* () {
  const swarm = yield* Swarm;
  const config = yield* PersonConfig;
  const scope = yield* Scope.Scope;
  const me = swarm.identity.pubkey;

  let person = config.stored?.person ?? me;
  let log: PersonLog | null = null;
  let logScope: Scope.Closeable | null = null;
  let folded: Devices = NO_DEVICES;
  let entries: ReadonlyArray<DeviceEntry> = [];
  /** peers we shared with, and the peers whose identity we take: until when */
  const offers = new Map<string, number>();
  const wants = new Map<string, { readonly until: number; person: string | null }>();
  /** writers already let into the log from here */
  const letIn = new Set<string>();

  const stateNow = (rooms: ReadonlyArray<PersonRoom>): PersonState => {
    const mine = devicesOf(folded, person);
    return { person, device: me, parent: mine.parent, devices: [...mine.devices].map(([key, name]) => ({ key, name })), rooms };
  };
  const state = yield* SubscriptionRef.make(stateNow([]));

  const send = (key: string, frame: Frame) => swarm.write(key, IDENTITY_TOPIC, frame).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void));

  const refresh = Effect.gen(function* () {
    if (!log) return;
    const view = yield* log.read;
    entries = view.devices;
    folded = foldDevices(entries);
    yield* SubscriptionRef.set(state, stateNow(view.rooms));
  });

  /** Ask one of our devices to let this one write to our log (nothing to ask once it can). */
  const askToWrite = (key: string) => Effect.suspend(() => (log && !log.writable() && key !== me ? send(key, { kind: "person-join", writer: log.writerKey }) : Effect.void));

  const hooks: TopicHooks = {
    greet: askToWrite,
    onPeerGone: () => Effect.void,
    onFrame: () => Effect.void,
  };

  /** Open the person's log (make it, when `key` is null) and follow it. */
  const attach = (key: string | null, encryption: Exclude<LogEncryption, "none">) =>
    Effect.gen(function* () {
      if (logScope) yield* Scope.close(logScope, Exit.void);
      const child = yield* Scope.fork(scope);
      const opened = yield* openPersonLog(swarm.store, person, key, encryption, swarm.wakeup).pipe(Effect.provideService(Scope.Scope, child));
      log = opened;
      logScope = child;
      letIn.clear();
      yield* config.save({ person, logKey: opened.key, encryptionKey: opened.encryptionKey });
      yield* refresh;
      yield* opened.changes.pipe(Stream.tap(() => refresh), Stream.runDrain, Effect.forkIn(child));
      yield* swarm.join(personTopic(opened.key, config.net), hooks).pipe(Effect.provideService(Scope.Scope, child));
      return opened;
    });

  /** A parent's act, on the log: it follows the last one that counted. */
  const act = (what: DeviceAct, after: string | null) =>
    Effect.gen(function* () {
      const opened = log;
      if (!opened || !opened.writable()) return "not-writable" as const;
      const entry = signDevice({ id: randomUUID(), person, by: me, at: yield* Clock.currentTimeMillis, after, act: what }, swarm.identity.keyPair);
      yield* opened.append({ op: "device", entry }).pipe(Effect.orDie);
      yield* refresh;
      return entry;
    });
  const asParent = (what: DeviceAct): Effect.Effect<DeviceEntry | "not-parent" | "not-writable"> =>
    Effect.gen(function* () {
      const mine = devicesOf(folded, person);
      if (mine.parent !== me) return "not-parent" as const;
      return yield* act(what, mine.head);
    });

  const armed = (until: number | undefined, now: number) => until !== undefined && until > now;

  const onFrame = (from: string, frame: Frame): Effect.Effect<void> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      switch (frame.kind) {
        case "identity-want":
          if (armed(offers.get(from), now)) yield* send(from, { kind: "identity-offer", person });
          return;
        case "identity-offer": {
          const want = wants.get(from);
          if (!want || !armed(want.until, now)) return;
          want.person = frame.person;
          return yield* send(from, { kind: "identity-take", person: frame.person, consent: signConsent(frame.person, me, swarm.identity.keyPair), name: config.deviceName });
        }
        case "identity-take": {
          const opened = log;
          if (!opened || frame.person !== person || !armed(offers.get(from), now)) return;
          const made = yield* asParent({ kind: "link", device: from, name: frame.name, consent: frame.consent });
          // the fold has the last word: a consent that does not prove out, a device already someone's
          if (typeof made === "string" || personOf(folded, from) !== person) return yield* Effect.logWarning(`${from.slice(0, 8)} was not taken in as a device`);
          offers.delete(from);
          const sealed = sealFor(from, b4a.from(JSON.stringify({ logKey: opened.key, encryptionKey: opened.encryptionKey })));
          if (sealed) yield* send(from, { kind: "identity-keys", person, sealed });
          return yield* Effect.log(`${from.slice(0, 8)} is now one of this person's devices`);
        }
        case "identity-keys": {
          const want = wants.get(from);
          if (!want || !armed(want.until, now) || want.person !== frame.person) return;
          const opened = openSealed(frame.sealed, swarm.identity.keyPair);
          if (!opened) return;
          const keys = JSON.parse(b4a.toString(opened)) as { logKey?: unknown; encryptionKey?: unknown };
          if (typeof keys.logKey !== "string" || typeof keys.encryptionKey !== "string") return;
          wants.delete(from);
          person = frame.person;
          yield* attach(keys.logKey, { key: keys.encryptionKey });
          yield* Effect.log(`this device is now one of ${person.slice(0, 8)}'s`);
          return yield* askToWrite(from);
        }
        case "person-join": {
          const opened = log;
          // only for a device the acts say is this person's
          if (!opened || !opened.writable() || letIn.has(frame.writer) || from === me || personOf(folded, from) !== person || !devicesOf(folded, person).devices.has(from)) return;
          letIn.add(frame.writer);
          return yield* opened.append({ op: "add-writer", key: frame.writer }).pipe(Effect.catch(() => Effect.sync(() => void letIn.delete(frame.writer))));
        }
        default:
          return;
      }
    });

  yield* swarm.listen(IDENTITY_TOPIC, { greet: () => Effect.void, onPeerGone: () => Effect.void, onFrame });
  if (config.stored) yield* attach(config.stored.logKey, { key: config.stored.encryptionKey });
  // an ask to write can be lost with a connection: keep asking our other devices
  yield* Effect.suspend(() => Effect.forEach([...devicesOf(folded, person).devices.keys()], askToWrite, { discard: true })).pipe(Effect.schedule(Schedule.spaced("10 seconds")), Effect.forkScoped);

  /** Share this identity with `peer`: they become one of our devices once
   *  they take it — told to on their side, naming us. Only the parent can. */
  const share = Effect.fn("Person.share")(function* (peer: string) {
    if (devicesOf(folded, person).parent !== me) return "not-parent" as const;
    if (!log) yield* attach(null, "new");
    offers.set(peer, (yield* Clock.currentTimeMillis) + HANDSHAKE_PATIENCE_MS);
    yield* send(peer, { kind: "identity-offer", person });
    return "offered" as const;
  });

  /** Take on `peer`'s identity: this device becomes one of theirs once they
   *  share it — told to on their side, naming us. Not for a device that is
   *  already someone's, or has devices of its own. */
  const take = Effect.fn("Person.take")(function* (peer: string) {
    if (person !== me || devicesOf(folded, me).devices.size > 1) return "already-linked" as const;
    wants.set(peer, { until: (yield* Clock.currentTimeMillis) + HANDSHAKE_PATIENCE_MS, person: null });
    yield* send(peer, { kind: "identity-want" });
    return "asked" as const;
  });

  /** Call one of our devices something; any of them may. */
  const name = Effect.fn("Person.name")(function* (device: string, called: string) {
    if (!devicesOf(folded, person).devices.has(device)) return "not-a-device" as const;
    if (!log) yield* attach(null, "new");
    const made = yield* act({ kind: "name", device, name: called }, null);
    return typeof made === "string" ? made : ("named" as const);
  });

  /** Put one of our devices out: nothing it signs from here counts as ours. The parent's to do. */
  const putOut = Effect.fn("Person.putOut")(function* (device: string) {
    const mine = devicesOf(folded, person);
    if (!mine.devices.has(device)) return "not-a-device" as const;
    if (device === mine.parent) return "is-parent" as const;
    const made = yield* asParent({ kind: "unlink", device });
    return typeof made === "string" ? made : ("out" as const);
  });

  /** Hand the parent's part to another of our devices. The parent's to do; it is an ordinary device after. */
  const handOver = Effect.fn("Person.handOver")(function* (device: string) {
    const mine = devicesOf(folded, person);
    if (!mine.devices.has(device)) return "not-a-device" as const;
    if (device === mine.parent) return "is-parent" as const;
    const made = yield* asParent({ kind: "parent", device });
    return typeof made === "string" ? made : ("handed" as const);
  });

  return { state, share, take, name, putOut, handOver } as const;
});

export type Person = Effect.Success<typeof makePerson>;
