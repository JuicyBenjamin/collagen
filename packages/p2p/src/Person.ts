import { createHash, randomUUID } from "node:crypto";
import { Clock, Context, Effect, Exit, Schedule, Scope, Stream, SubscriptionRef } from "effect";
import b4a from "b4a";
import { devicesOf, foldDevices, NO_DEVICES, personOf, signConsent, signDevice, type DeviceAct, type DeviceEntry, type Devices } from "./devices";
import { openSealed, sealFor } from "./invite";
import { checkDeviceCode, DEVICE_CODE_LIFETIME_MS, deviceCodeTopic, formatDeviceCode, newDeviceCode, parseDeviceCode, proveDeviceCode, type DeviceCode } from "./deviceCode";
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
  /** where in the store that log lives; absent for a log kept before logs moved (it lives under the person's key) */
  readonly space?: string;
}

export class PersonConfig extends Context.Service<PersonConfig, {
  readonly net: Net;
  /** what was kept from before; null for a device that is its own person, alone */
  readonly stored: PersonStored | null;
  readonly save: (stored: PersonStored) => Effect.Effect<void>;
  /** this device was put out: it is its own person again, and keeps nothing of theirs */
  readonly forget: Effect.Effect<void>;
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
  /** the acts about their devices, in log order: what each room they are in is given */
  readonly acts: ReadonlyArray<DeviceEntry>;
  /** the rooms their devices are in, and the ones they left */
  readonly rooms: ReadonlyArray<PersonRoom>;
  readonly left: ReadonlyArray<string>;
  /** what the person is called on every device, once one of them said */
  readonly name: string | null;
  /** whether this device can write to the person's log (false while alone: there is none) */
  readonly writable: boolean;
}

/** Why an act about devices was not made. */
export type PersonRefusal = "not-parent" | "not-a-device" | "already-linked" | "is-parent" | "not-writable" | "not-a-code" | "other-net";

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
  const me = swarm.identity.device;

  let person = config.stored?.person ?? me;
  /** where in the store the log we hold lives */
  let space = config.stored?.space ?? person;
  /** the log is being changed for another (it moved): one change at a time */
  let switching = false;
  let log: PersonLog | null = null;
  let logScope: Scope.Closeable | null = null;
  let folded: Devices = NO_DEVICES;
  let entries: ReadonlyArray<DeviceEntry> = [];
  /** peers we shared with, and the peers whose identity we take: until when */
  const offers = new Map<string, number>();
  const wants = new Map<string, { readonly until: number; person: string | null }>();
  /** writers already let into the log from here */
  const letIn = new Set<string>();
  /** device codes we made, by id: the half that checks one, until when, and the scope that keeps us findable for it */
  const codes = new Map<string, { readonly publicKey: string; readonly until: number; readonly findable: Scope.Closeable }>();
  /** the device code we came with, until when */
  let entered: { readonly code: DeviceCode; readonly until: number; readonly findable: Scope.Closeable } | null = null;
  // Whose we are is the acts' to say, not a peer's: handed a log, this device
  // is its person only once that log names it one of their devices. Kept
  // from before, it was already so.
  let confirmed = true;

  const stateNow = (rooms: ReadonlyArray<PersonRoom>, left: ReadonlyArray<string>, called: string | null = null): PersonState => {
    if (!confirmed) return { person: me, device: me, parent: me, devices: [{ key: me, name: "" }], acts: [], rooms: [], left: [], name: null, writable: false };
    const mine = devicesOf(folded, person);
    return { person, device: me, parent: mine.parent, devices: [...mine.devices].map(([key, name]) => ({ key, name })), acts: entries, rooms, left, name: called, writable: log?.writable() ?? false };
  };
  const state = yield* SubscriptionRef.make(stateNow([], []));

  const send = (key: string, frame: Frame) => swarm.write(key, IDENTITY_TOPIC, frame).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void));

  const refresh = Effect.gen(function* () {
    if (!log) return;
    const view = yield* log.read;
    entries = view.devices;
    folded = foldDevices(entries);
    if (!confirmed && devicesOf(folded, person).devices.has(me)) {
      confirmed = true;
      yield* config.save({ person, logKey: log.key, encryptionKey: log.encryptionKey, space });
      yield* Effect.log(`this device is now one of ${person.slice(0, 8)}'s`);
    }
    // put out: this device is its own person again, and lets go of theirs
    // (the device the person started on as well: its key is still what they are known by, but it is not them any more)
    if (confirmed && folded.gone.has(me)) {
      yield* Effect.logWarning(`this device was put out: it is no longer one of ${person.slice(0, 8)}'s`);
      const held = logScope;
      log = null;
      logScope = null;
      person = me;
      space = me;
      folded = NO_DEVICES;
      entries = [];
      yield* config.forget;
      yield* SubscriptionRef.set(state, stateNow([], []));
      // not from inside the log's own fibre: closing it would end this
      if (held) yield* Scope.close(held, Exit.void).pipe(Effect.forkIn(scope));
      return;
    }
    // the log moved to a new key (a device was put out): follow it with the key sealed for us
    if (view.moved && view.moved.to !== log.key && !switching) {
      const sealed = view.moved.sealed[me];
      const opened = sealed ? openSealed(sealed, swarm.identity.keyPair) : null;
      if (opened) {
        switching = true;
        const moved = view.moved;
        return yield* attach(moved.to, { key: b4a.toString(opened, "hex") }, moved.to).pipe(
          Effect.ensuring(Effect.sync(() => void (switching = false))),
          Effect.forkIn(scope),
          Effect.asVoid,
        );
      }
    }
    yield* SubscriptionRef.set(state, stateNow(view.rooms, view.left, view.name));
  });

  /** Ask one of our devices to let this one write to our log (nothing to ask once it can). */
  const askToWrite = (key: string) => Effect.suspend(() => (log && !log.writable() && key !== me ? send(key, { kind: "person-join", writer: log.writerKey }) : Effect.void));

  const hooks: TopicHooks = {
    greet: askToWrite,
    onPeerGone: () => Effect.void,
    onFrame: () => Effect.void,
  };

  /** Open the person's log (make it, when `key` is null) and follow it. */
  const attach: (key: string | null, encryption: Exclude<LogEncryption, "none">, at: string) => Effect.Effect<PersonLog> = (key, encryption, at) =>
    Effect.gen(function* () {
      if (logScope) yield* Scope.close(logScope, Exit.void);
      const child = yield* Scope.fork(scope);
      const opened = yield* openPersonLog(swarm.store, at, key, encryption, swarm.wakeup).pipe(Effect.provideService(Scope.Scope, child));
      log = opened;
      logScope = child;
      space = at;
      letIn.clear();
      if (confirmed) yield* config.save({ person, logKey: opened.key, encryptionKey: opened.encryptionKey, space });
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
          if (!opened || frame.person !== person) return;
          const held = frame.code ? codes.get(frame.code.id) : undefined;
          const byCode = held !== undefined && frame.code !== undefined && armed(held.until, now) && checkDeviceCode(person, frame.code.id, held.publicKey, from, frame.code.proof);
          const keysFor = () => {
            const sealed = sealFor(from, b4a.from(JSON.stringify({ logKey: opened.key, encryptionKey: opened.encryptionKey })));
            return sealed ? send(from, { kind: "identity-keys", person, sealed }) : Effect.void;
          };
          // already ours (its first keys were lost on the way): the keys again, no second act
          if (devicesOf(folded, person).devices.has(from) && from !== me) return yield* keysFor();
          if (!byCode && !armed(offers.get(from), now)) return;
          const made = yield* asParent({ kind: "link", device: from, name: frame.name, consent: frame.consent });
          // the fold has the last word: a consent that does not prove out, a device already someone's
          if (typeof made === "string" || personOf(folded, from) !== person) return yield* Effect.logWarning(`${from.slice(0, 8)} was not taken in as a device`);
          offers.delete(from);
          // a code lets one device in
          if (byCode && frame.code) {
            codes.delete(frame.code.id);
            yield* Scope.close(held.findable, Exit.void);
          }
          yield* keysFor();
          return yield* Effect.log(`${from.slice(0, 8)} is now one of this person's devices`);
        }
        case "identity-keys": {
          const want = wants.get(from);
          const named = want !== undefined && armed(want.until, now) && want.person === frame.person;
          const coded = entered !== null && armed(entered.until, now) && entered.code.person === frame.person;
          if ((!named && !coded) || person !== me) return;
          const opened = openSealed(frame.sealed, swarm.identity.keyPair);
          if (!opened) return;
          const keys = JSON.parse(b4a.toString(opened)) as { logKey?: unknown; encryptionKey?: unknown };
          if (typeof keys.logKey !== "string" || typeof keys.encryptionKey !== "string") return;
          wants.delete(from);
          if (entered) {
            yield* Scope.close(entered.findable, Exit.void);
            entered = null;
          }
          person = frame.person;
          confirmed = false;
          yield* attach(keys.logKey, { key: keys.encryptionKey }, keys.logKey);
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
  if (config.stored) yield* attach(config.stored.logKey, { key: config.stored.encryptionKey }, space);
  // a frame to a peer just connected can be lost: while a share or a take waits, say it again
  yield* Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const [peer, until] of offers) {
      if (until > now) yield* send(peer, { kind: "identity-offer", person });
      else offers.delete(peer);
    }
    for (const [id, held] of codes) {
      if (held.until > now) continue;
      codes.delete(id);
      yield* Scope.close(held.findable, Exit.void);
    }
    if (entered && entered.until <= now) {
      yield* Scope.close(entered.findable, Exit.void);
      entered = null;
    }
    for (const [peer, want] of wants) {
      if (want.until > now) yield* send(peer, { kind: "identity-want" });
      else wants.delete(peer);
    }
  }).pipe(Effect.schedule(Schedule.spaced("3 seconds")), Effect.forkScoped);
  // an ask to write can be lost with a connection: keep asking our other devices
  yield* Effect.suspend(() => Effect.forEach([...devicesOf(folded, person).devices.keys()], askToWrite, { discard: true })).pipe(Effect.schedule(Schedule.spaced("10 seconds")), Effect.forkScoped);

  /** Share this identity with `peer`: they become one of our devices once
   *  they take it — told to on their side, naming us. Only the parent can. */
  const share = Effect.fn("Person.share")(function* (peer: string) {
    if (devicesOf(folded, person).parent !== me) return "not-parent" as const;
    if (!log) yield* attach(null, "new", person);
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

  /** A device code: whoever enters it on another machine becomes one of our
   *  devices. Making it is our half of the handshake — good for one device,
   *  for ten minutes. Only the parent can. */
  const makeCode = Effect.fn("Person.makeCode")(function* () {
    if (devicesOf(folded, person).parent !== me) return "not-parent" as const;
    if (!log) yield* attach(null, "new", person);
    const made = newDeviceCode(person, config.net);
    const findable = yield* Scope.fork(scope);
    yield* swarm.join(deviceCodeTopic(made.code), { greet: () => Effect.void, onPeerGone: () => Effect.void, onFrame: () => Effect.void }).pipe(Effect.provideService(Scope.Scope, findable));
    codes.set(made.code.id, { publicKey: made.publicKey, until: (yield* Clock.currentTimeMillis) + DEVICE_CODE_LIFETIME_MS, findable });
    return { code: formatDeviceCode(made.code) } as const;
  });

  /** Enter a device code made on another machine: this device becomes one
   *  of that person's. Not for a device that is already someone's, or has
   *  devices of its own. */
  const useCode = Effect.fn("Person.useCode")(function* (text: string) {
    const code = parseDeviceCode(text);
    if (!code) return "not-a-code" as const;
    if (code.net !== config.net) return "other-net" as const;
    if (person !== me || devicesOf(folded, me).devices.size > 1) return "already-linked" as const;
    if (entered) yield* Scope.close(entered.findable, Exit.void);
    const findable = yield* Scope.fork(scope);
    entered = { code, until: (yield* Clock.currentTimeMillis) + DEVICE_CODE_LIFETIME_MS, findable };
    // whoever is on the code's topic is asked; only the one that made it can answer
    const ask = (key: string) =>
      Effect.suspend(() =>
        entered?.code.id === code.id
          ? send(key, { kind: "identity-take", person: code.person, consent: signConsent(code.person, me, swarm.identity.keyPair), name: config.deviceName, code: { id: code.id, proof: proveDeviceCode(code, me) } })
          : Effect.void,
      );
    yield* swarm.join(deviceCodeTopic(code), { greet: ask, onPeerGone: () => Effect.void, onFrame: () => Effect.void }).pipe(Effect.provideService(Scope.Scope, findable));
    return "asked" as const;
  });

  /** Move the person's log to a new key, sealed for the devices that are
   *  theirs now: one just put out holds the old key, and reads nothing
   *  written from here. The log as it stands is carried over whole. */
  const moveLog = Effect.gen(function* () {
    const old = log;
    if (!old || switching) return;
    switching = true;
    yield* Effect.gen(function* () {
      const view = yield* old.read;
      const at = `${person}/${randomUUID()}`;
      const making = yield* Scope.fork(scope);
      const next = yield* openPersonLog(swarm.store, at, null, "new", swarm.wakeup).pipe(Effect.provideService(Scope.Scope, making));
      yield* next
        .appendAll([
          ...view.devices.map((entry) => ({ op: "device" as const, entry })),
          ...view.rooms.map((room) => ({ op: "room" as const, room })),
          ...view.left.map((id) => ({ op: "leave" as const, id })),
          ...(view.name !== null ? [{ op: "name" as const, name: view.name }] : []),
        ])
        .pipe(Effect.orDie);
      const moved = { to: next.key, key: next.encryptionKey };
      yield* Scope.close(making, Exit.void);
      const sealed: Record<string, string> = {};
      for (const device of devicesOf(folded, person).devices.keys()) {
        const box = sealFor(device, b4a.from(moved.key, "hex"));
        if (box) sealed[device] = box;
      }
      yield* old.append({ op: "moved", to: moved.to, sealed }).pipe(Effect.orDie);
      yield* attach(moved.to, { key: moved.key }, at);
      yield* Effect.log(`moved this person's log to a new key (${Object.keys(sealed).length} device(s))`);
    }).pipe(Effect.ensuring(Effect.sync(() => void (switching = false))));
  });

  /** Call one of our devices something; any of them may. */
  const name = Effect.fn("Person.name")(function* (device: string, called: string) {
    if (!devicesOf(folded, person).devices.has(device)) return "not-a-device" as const;
    if (!log) yield* attach(null, "new", person);
    const made = yield* act({ kind: "name", device, name: called }, null);
    return typeof made === "string" ? made : ("named" as const);
  });

  /** Put one of our devices out: nothing it signs from here counts as ours. The parent's to do. */
  const putOut = Effect.fn("Person.putOut")(function* (device: string) {
    const mine = devicesOf(folded, person);
    if (!mine.devices.has(device)) return "not-a-device" as const;
    if (device === mine.parent) return "is-parent" as const;
    const made = yield* asParent({ kind: "unlink", device });
    if (typeof made === "string") return made;
    yield* moveLog;
    return "out" as const;
  });

  /** Hand the parent's part to another of our devices. The parent's to do; it is an ordinary device after. */
  const handOver = Effect.fn("Person.handOver")(function* (device: string) {
    const mine = devicesOf(folded, person);
    if (!mine.devices.has(device)) return "not-a-device" as const;
    if (device === mine.parent) return "is-parent" as const;
    const made = yield* asParent({ kind: "parent", device });
    return typeof made === "string" ? made : ("handed" as const);
  });

  /** A room this person is in, for their other devices to open: said again when its keys or name change. Nothing to say while alone. */
  const rememberRoom = (room: PersonRoom) => Effect.suspend(() => (log && log.writable() ? log.append({ op: "room", room }).pipe(Effect.ignore) : Effect.void));
  /** A room this person left: their other devices leave it too. */
  const forgetRoom = (id: string) => Effect.suspend(() => (log && log.writable() ? log.append({ op: "leave", id }).pipe(Effect.ignore) : Effect.void));

  /** What the person is called, for every device of theirs. Nothing to say while alone. */
  const rememberName = (called: string) => Effect.suspend(() => (log && log.writable() ? log.append({ op: "name", name: called }).pipe(Effect.ignore) : Effect.void));

  return { state, share, take, makeCode, useCode, name, putOut, handOver, rememberRoom, forgetRoom, rememberName } as const;
});

export type Person = Effect.Success<typeof makePerson>;
