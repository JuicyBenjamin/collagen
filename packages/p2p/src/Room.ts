import { randomUUID } from "node:crypto";
import { Clock, Context, Effect, Exit, Layer, PubSub, Schedule, Scope, Semaphore, Stream, SubscriptionRef } from "effect";
import {
  PROTOCOL_VERSION,
  type DriveAction,
  type Frame,
  type Member,
  type Peer,
  type RoomMessage,
  type SharedProfile,
  type Attachment,
  type AttachmentFrame,
  type TranscriptFrame,
  type TranscriptRequestFrame,
} from "./schema";
import { NotWritable, PeerNotConnected } from "./errors";
import type { Conversation } from "./acting";
import type { ReviewComment, ReviewContext } from "./review";
import type { Ticket } from "./ticket";
import { deriveThreadId, roomTopic, type Net } from "./topic";
import { checkProof, formatInvite, INVITE_LIFETIME_MS, newInvite, openSealed, proveInvite, sealFor, type Invite } from "./invite";
import { openRoomLog, type LogEncryption, type LogView, type RoomLog, type Unseen } from "./RoomLog";
import type { LogOp } from "./schema";
import b4a from "b4a";
import { Swarm, type TopicHooks } from "./Swarm";

export class RoomConfig extends Context.Service<RoomConfig, {
  readonly roomName: string;
  /** live (a release) or dev (a run from source) — picks the swarm topic salt. */
  readonly net: Net;
  /** The room's display name as we last knew it (shown until the log says otherwise). */
  readonly roomLabel: RoomMeta;
  /** Re-evaluated on every broadcast, so profile changes are picked up live. */
  readonly getProfile: Effect.Effect<SharedProfile>;
  /** The room's log: its key if we know it (persisted after the first time),
   *  the key that reads it (null for a log from before rooms were encrypted,
   *  which is moved to an encrypted one on opening), and whether we created
   *  the room — the creator makes the log; a joiner is handed its keys. */
  readonly log: { readonly key: string | null; readonly encryptionKey: string | null; readonly creator: boolean };
  /** The invite we are joining with, until a member has let us in. */
  readonly invite: Invite | null;
  /** Rooms as they were before encryption: new logs plain, none moved.
   *  Only for the end-to-end run that makes an old room to move. */
  readonly plainLogs?: boolean;
}>()("p2p/RoomConfig") {}

export interface RoomMeta {
  readonly name: string;
  readonly ts: number;
}

/** A message on the room's log, with its position (the inbox cursor unit). */
export interface LoggedMessage {
  readonly seq: number;
  readonly message: RoomMessage;
}

/**
 * A room: one topic on the identity's swarm for presence, and one shared
 * Autobase log for everything that must outlive a connection — messages,
 * tickets, the room's name, membership. Every member holds the log (it
 * replicates over the same connections), so state survives restarts and
 * reaches peers that were offline.
 */
export class Room extends Context.Service<Room>()("p2p/Room", {
  make: Effect.gen(function* () {
    const config = yield* RoomConfig;
    const swarm = yield* Swarm;
    const scope = yield* Effect.scope;
    const me = swarm.identity.pubkey;

    // Presence (ephemeral, from greets) …
    const roster = yield* SubscriptionRef.make<ReadonlyArray<Peer>>([]);
    // … and the room as the log tells it.
    const tickets = yield* SubscriptionRef.make<ReadonlyMap<string, Ticket>>(new Map());
    const meta = yield* SubscriptionRef.make<RoomMeta>(config.roomLabel);
    const members = yield* SubscriptionRef.make<ReadonlyArray<Member>>([]);
    const trace = yield* SubscriptionRef.make<ReadonlyArray<RoomMessage>>([]);
    const logKey = yield* SubscriptionRef.make<string | null>(config.log.key);
    // the key that reads the log — kept beside its key, never on the log
    const encryptionKey = yield* SubscriptionRef.make<string | null>(config.log.encryptionKey);
    // why the invite we are joining with was turned down, or why we cannot follow the room
    const refusal = yield* SubscriptionRef.make<string | null>(null);
    const writable = yield* SubscriptionRef.make(false);
    // Messages addressed to us, as the view has them. Consumers subscribe to
    // `messages`, which replays these and then follows — a PubSub would drop
    // whatever the log already held before anyone was listening.
    const mine = yield* SubscriptionRef.make<ReadonlyArray<LoggedMessage>>([]);
    const driveRequests = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; action: DriveAction }>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    // Transcript diagnostics: asks arrive here (the app puts them in the
    // person's outbox), answers arrive here (the app files them). Both direct.
    const transcriptRequests = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; request: TranscriptRequestFrame }>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const transcripts = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; transcript: TranscriptFrame }>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    // Transcripts attached to tickets (from the log) and peers asking us for one.
    const attachments = yield* SubscriptionRef.make<ReadonlyArray<Attachment>>([]);
    // The why behind review tickets, as the log has it.
    const reviews = yield* SubscriptionRef.make<ReadonlyArray<ReviewContext>>([]);
    // Comments on reviews' code, said in the room.
    const comments = yield* SubscriptionRef.make<ReadonlyArray<ReviewComment>>([]);
    // records a newer build wrote that this one cannot read yet (RoomLog.Unseen)
    const unseen = yield* SubscriptionRef.make<ReadonlyArray<Unseen>>([]);
    const fetchRequests = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; attachmentId: string }>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const attachmentsIn = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; attachment: AttachmentFrame }>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );

    // Peers present in THIS room (they greeted us here), whom we greeted, and
    // which joiners we already admitted. Only touched from effects.
    const peers = new Map<string, Peer>();
    const greeted = new Set<string>();
    /** peers told where the current log is (cleared when the log changes) */
    const announced = new Set<string>();
    const admitted = new Set<string>();
    // who may be in an encrypted room: its members and whoever an invite let
    // in. Anyone else on the topic (an old invite, a stray peer) hears
    // nothing from us but a refusal, and is never let in.
    const known = new Set<string>([me]);
    // peers on the topic we do not let in (yet): kept out of the roster
    const strangers = new Map<string, Peer>();
    // who we asked to let us in with our invite (only their keys are taken)
    const redeemAsked = new Set<string>();
    // every live connection on this room's topic, said hello to or not: a
    // newcomer shows its invite to all of them, members keeping quiet to strangers
    const connected = new Set<string>();
    // the invite we are joining with — handed in at the start, or later to a
    // room we list but were never let into
    let joining: Invite | null = config.invite;
    // join requests we couldn't serve yet (no log, or not admitted ourselves)
    const pendingJoins = new Set<string>();
    let log: RoomLog | null = null;
    // the view as last read, for what follows a refresh (moving the room)
    let lastView: LogView | null = null;
    let logScope: Scope.Closeable | null = null;
    const publishRoster = Effect.suspend(() => SubscriptionRef.set(roster, [...peers.values()]));

    let topicHex = "";
    const send = (key: string, frame: Frame) => swarm.write(key, topicHex, frame);
    /** To everyone present; a peer that vanished mid-write is skipped. */
    const broadcast = (frame: Frame) =>
      Effect.forEach([...peers.keys()], (key) => send(key, frame).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void)), {
        discard: true,
      });

    /** The room keeps strangers out: its log is encrypted. A log from before
     *  that, while it is being moved, is open as it always was. */
    const gated = () => log !== null && log.encryptionKey !== null;
    const allowed = (key: string) => !gated() || known.has(key);

    const requireLog = Effect.suspend(() =>
      log && log.writable() ? Effect.succeed(log) : Effect.fail(new NotWritable({ roomId: config.roomName })),
    );

    /** Re-read the view into the refs; publish messages for us not seen yet. */
    // one refresh at a time: each reads the whole view, then sets every ref
    // from it. Two at once (an agent's write and the delivery of a step, say)
    // could finish out of order, and the older read would land last — a
    // ticket closed a moment ago shown open until the next write
    const refreshing = Semaphore.makeUnsafe(1);
    const refresh = refreshing.withPermit(Effect.gen(function* () {
      if (!log) return;
      const view = yield* log.read;
      yield* Effect.logDebug(
        `log view: ${view.tickets.length} ticket(s) · ${view.messages.length} message(s) · ${view.members.length} member(s) · writable=${String(log.writable())}`,
      );
      yield* SubscriptionRef.set(tickets, new Map(view.tickets.map((ticket) => [ticket.id, ticket])));
      yield* SubscriptionRef.set(members, view.members);
      for (const member of view.members) known.add(member.key);
      for (const invite of view.invites) if (invite.usedBy) known.add(invite.usedBy);
      lastView = view;
      yield* SubscriptionRef.set(trace, view.messages.map((logged) => logged.message));
      yield* SubscriptionRef.set(attachments, view.attachments);
      yield* SubscriptionRef.set(reviews, view.reviews);
      yield* SubscriptionRef.set(comments, view.comments);
      yield* SubscriptionRef.set(unseen, view.unseen);
      const name = view.name;
      if (name) yield* SubscriptionRef.update(meta, (current) => (name.ts > current.ts ? name : current));
      yield* SubscriptionRef.set(writable, log.writable());
      yield* SubscriptionRef.set(mine, view.messages.filter((logged) => logged.message.to === me));
      // records from a build speaking another protocol version never reach
      // the app as they are. Those we know how to read are rewritten into the
      // current shape for everyone; our own that an earlier build evicted
      // before it knew how are put back, once per open; only what nobody can
      // read is taken off the room. Each write's own log entry brings us back
      // here with less left to do.
      yield* log.rewriteMigrated;
      if (!restoredOwn) {
        const ran = yield* log.restoreOwn;
        if (ran !== null) restoredOwn = true; // once — but only once it could actually run
      }
      yield* log.evictStale;
    }));

    /** Admit everyone who asked while we couldn't. */
    const admitPending = Effect.gen(function* () {
      const roomLog = log;
      if (!roomLog || !roomLog.writable()) return;
      for (const writer of [...pendingJoins]) {
        pendingJoins.delete(writer);
        if (admitted.has(writer)) continue;
        admitted.add(writer);
        yield* Effect.log(`admitting ${writer.slice(0, 8)} to the room log`);
        // a failed admit is not an admit: their next ask (every few seconds) tries again
        yield* roomLog.append({ op: "add-writer", key: writer }).pipe(
          Effect.catch((error) => Effect.logWarning(`admit failed: ${error.message}`).pipe(Effect.andThen(Effect.sync(() => void admitted.delete(writer))))),
        );
      }
    });

    /** Say who we are on the log — once we can write to it. The creator also
     *  puts the room's name there the first time, so a room named before the
     *  log existed (or named at creation) reaches joiners by name. */
    const introduce = Effect.gen(function* () {
      if (!log || !log.writable()) return;
      const profile = yield* config.getProfile;
      const now = yield* Clock.currentTimeMillis;
      yield* log.append({ op: "member", key: me, name: profile.name, ts: now }).pipe(Effect.ignore);
      const view = yield* log.read;
      const label = config.roomLabel;
      if (config.log.creator && view.name === null && label.ts > 0) {
        yield* log.append({ op: "rename", name: label.name, ts: label.ts }).pipe(Effect.ignore);
      }
    });

    const logInfo = Effect.gen(function* () {
      const roomLog = log;
      if (!roomLog) return null;
      const count = (yield* SubscriptionRef.get(members)).length;
      const frame: Frame = { kind: "log-info", key: roomLog.key, members: count };
      return frame;
    });

    /** Let go of the log we hold (to adopt another one). */
    const dropLog = Effect.gen(function* () {
      if (logScope) yield* Scope.close(logScope, Exit.void);
      log = null;
      logScope = null;
      announced.clear();
      yield* SubscriptionRef.set(writable, false);
      yield* SubscriptionRef.set(mine, []);
    });

    /** Bring the log up (create it, or open a key we learned) and follow it.
     *
     *  Guarded against a SECOND caller arriving while the first is still
     *  opening: `log` is only set once Autobase is ready, so the boot path and
     *  a peer's `log-info` frame could both get past a `if (log)` check and
     *  open the same base twice — two Autobases on one writer core in one
     *  Corestore namespace, which blocks on the storage lock and never
     *  finishes. That was the returning-peer stall: the room logged "room log
     *  opened" and the app never came up. The flag is set before the first
     *  await, so nothing can slip between. */
    let attaching = false;
    let restoredOwn = false;
    const attachLog = (key: string | null, encryption: LogEncryption): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (log || attaching) return;
        attaching = true;
        const child = yield* Scope.fork(scope);
        const opened = yield* openRoomLog(swarm.store, config.roomName, key, encryption).pipe(
          Effect.provideService(Scope.Scope, child),
        );
        yield* adopt(opened, child, key ? "opened" : "created");
      }).pipe(Effect.ensuring(Effect.sync(() => void (attaching = false))));

    /** Make `opened` the room's log and follow it: read it, say who we are,
     *  let in who asked, tell everyone allowed where it is. */
    const adopt = (opened: RoomLog, child: Scope.Closeable, how: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        log = opened;
        logScope = child;
        // the key that reads it first: whoever keeps the two together reads it when the log's key moves
        yield* SubscriptionRef.set(encryptionKey, opened.encryptionKey);
        yield* SubscriptionRef.set(logKey, opened.key);
        yield* Effect.log(`room log ${how}: ${opened.key.slice(0, 12)}… writable=${String(opened.writable())}${opened.encryptionKey ? " encrypted" : ""}`);
        // Everything past this point talks to Autobase, which may be waiting
        // on another member — so it runs in a fibre of its own. The room (and
        // with it the app, its MCP server, the TUI) is up as soon as the base
        // is open; the view, our `member` entry and the announcements land
        // when the log can. A returning peer used to hang here forever.
        let wasWritable = opened.writable();
        yield* Effect.gen(function* () {
          yield* refresh;
          yield* promoteKnown;
          yield* introduce;
          yield* admitPending;
          yield* moveOn;
          // tell everyone present where the log is (anyone whose profile has
          // not arrived yet hears it with their profile — see onFrame)
          announced.clear();
          yield* Effect.forEach([...peers.keys()], announceLog, { discard: true });
          yield* opened.changes.pipe(
            Stream.tap(() =>
              Effect.gen(function* () {
                yield* refresh;
                yield* promoteKnown;
                if (!wasWritable && opened.writable()) {
                  wasWritable = true;
                  yield* Effect.log("admitted to the room log");
                  yield* introduce;
                  yield* admitPending;
                }
                yield* moveOn;
              }),
            ),
            Stream.runDrain,
          );
        }).pipe(Effect.forkIn(child));
      });

    /** Joining with an invite and no log yet: show one peer we hold it. Our
     *  proof is bound to our identity, so overhearing it helps nobody. */
    const redeemWith = (key: string) =>
      Effect.suspend(() => {
        const invite = joining;
        if (!invite || log) return Effect.void;
        redeemAsked.add(key);
        return send(key, { kind: "redeem", inviteId: invite.id, proof: proveInvite(invite, me) }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void));
      });

    /** A newcomer shows an invite: check it against the log, let them in once
     *  (the first use in log order stands), and hand them the room's keys over
     *  this connection. Any member can do it, the one who invited or not. */
    const redeem = (from: string, inviteId: string, proof: string) =>
      Effect.gen(function* () {
        const roomLog = log;
        // nothing to hand over: a log from before encryption (it is moving), or none yet
        if (!roomLog || roomLog.encryptionKey === null) return;
        const refuse = (why: string) =>
          Effect.logWarning(`refused ${from.slice(0, 8)}'s invite ${inviteId.slice(0, 8)}: ${why}`).pipe(
            Effect.andThen(send(from, { kind: "refused", inviteId, why })),
            Effect.catchTag("PeerNotConnected", () => Effect.void),
          );
        const now = yield* Clock.currentTimeMillis;
        const invite = (yield* roomLog.read).invites.find((candidate) => candidate.id === inviteId);
        if (!invite) return yield* refuse("this room has no such invite — it may not have reached this member yet");
        if (!checkProof(config.roomName, invite.id, invite.publicKey, from, proof)) return yield* refuse("the invite does not prove out");
        if (invite.usedBy !== null && invite.usedBy !== from) return yield* refuse("this invite has been used — ask for a new one");
        if (invite.usedBy === null) {
          if (invite.expires < now) return yield* refuse("this invite has lapsed — ask for a new one");
          // a member not let in to write yet cannot record it: another member will
          if (!roomLog.writable()) return;
          const recorded = yield* roomLog.append({ op: "redeemed", id: invite.id, identity: from, by: me, ts: now }).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));
          if (!recorded) return;
          const after = (yield* roomLog.read).invites.find((candidate) => candidate.id === inviteId);
          if (after?.usedBy !== from) return yield* refuse("this invite has been used — ask for a new one");
          yield* Effect.log(`let ${from.slice(0, 8)} in with invite ${inviteId.slice(0, 8)}`);
        }
        known.add(from);
        yield* send(from, { kind: "keys", logKey: roomLog.key, encryptionKey: roomLog.encryptionKey }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void));
        yield* promote(from);
        yield* greet(from);
      });

    /** A peer we kept aside who turns out to belong: an invite let them in, or
     *  the log, read at last, names them a member (they may have connected
     *  before it was read). Into the roster, and greeted. */
    const promote = (key: string) =>
      Effect.suspend(() => {
        const stranger = strangers.get(key);
        if (!stranger || !allowed(key)) return Effect.void;
        strangers.delete(key);
        peers.set(key, stranger);
        return Effect.log(`peer online: ${stranger.name} (${key.slice(0, 8)})`).pipe(Effect.andThen(publishRoster), Effect.andThen(greet(key)));
      });
    const promoteKnown = Effect.suspend(() => Effect.forEach([...strangers.keys()], promote, { discard: true }));

    /** A member let us in: open the room with the keys they handed over — only
     *  for the log our invite names, so a stranger on the topic cannot hand
     *  us a room of their own. */
    const takeKeys = (from: string, logKeyHex: string, key: string) =>
      Effect.gen(function* () {
        const invite = joining;
        if (!invite || log || !redeemAsked.has(from)) return;
        if (logKeyHex !== invite.logKey) return yield* Effect.logWarning(`${from.slice(0, 8)} offered keys for another log than our invite names — ignored`);
        yield* SubscriptionRef.set(refusal, null);
        yield* attachLog(logKeyHex, { key });
        yield* askToJoin(from);
      });

    /** The room moved to an encrypted log: open it with the key sealed for us.
     *  Not among its members then, we cannot: we say so, and stay put. */
    const follow = (moved: NonNullable<LogView["moved"]>): Effect.Effect<void> =>
      Effect.gen(function* () {
        const sealed = moved.sealed[me];
        const opened = sealed ? openSealed(sealed, swarm.identity.keyPair) : null;
        if (!opened) {
          const why = "this room moved to an encrypted log while you were not among its members — ask one of them for an invite";
          yield* SubscriptionRef.set(refusal, why);
          return yield* Effect.logWarning(why);
        }
        yield* Effect.log(`the room moved to its encrypted log ${moved.to.slice(0, 12)}… — following`);
        yield* dropLog;
        yield* attachLog(moved.to, { key: b4a.toString(opened, "hex") });
      });

    /** Move a room from before encryption to an encrypted log: a new log
     *  carrying the room as it stands, then a `moved` entry on the old one with
     *  the new log's key sealed for each member. The first move stands: one
     *  that lost the race is let go, and the winner followed. */
    const moveRoom = (old: RoomLog, view: LogView): Effect.Effect<void> =>
      Effect.gen(function* () {
        const child = yield* Scope.fork(scope);
        const next = yield* openRoomLog(swarm.store, config.roomName, null, "new", "beside").pipe(Effect.provideService(Scope.Scope, child));
        const key = next.encryptionKey;
        if (key === null) return yield* Scope.close(child, Exit.void);
        const carried: Array<LogOp> = [
          ...view.members.map((member): LogOp => ({ op: "member", key: member.key, name: member.name, ts: member.ts })),
          ...(view.name ? [{ op: "rename", name: view.name.name, ts: view.name.ts } satisfies LogOp] : []),
          ...view.tickets.map((ticket): LogOp => ({ op: "ticket", ticket })),
          ...view.reviews.map((review): LogOp => ({ op: "review", review })),
          ...view.comments.map((comment): LogOp => ({ op: "comment", comment })),
          ...view.attachments.map((attachment): LogOp => ({ op: "attachment", attachment })),
          ...view.messages.map(({ message }): LogOp => ({ op: "msg", msg: message })),
        ];
        const copied = yield* next.appendAll(carried).pipe(Effect.as(true), Effect.catch((error) => Effect.logWarning(`moving the room failed: ${error.message}`).pipe(Effect.as(false))));
        if (!copied) return yield* Scope.close(child, Exit.void);
        const sealed: Record<string, string> = {};
        for (const identity of new Set([me, ...view.members.map((member) => member.key)])) {
          const box = sealFor(identity, b4a.from(key, "hex"));
          if (box) sealed[identity] = box;
        }
        const now = yield* Clock.currentTimeMillis;
        yield* old.append({ op: "moved", to: next.key, sealed, by: me, ts: now }).pipe(Effect.ignore);
        const after = (yield* old.read).moved;
        if (after?.to !== next.key) {
          yield* Scope.close(child, Exit.void);
          if (after) yield* follow(after);
          return;
        }
        yield* Effect.log(`moved the room to its encrypted log ${next.key.slice(0, 12)}… (${carried.length} record(s) carried, ${Object.keys(sealed).length} member(s))`);
        yield* dropLog;
        yield* adopt(next, child, "moved to");
      });

    /** A log from before encryption: follow the room where it moved, or move
     *  it ourselves once we can write. Runs in the room's own scope — it lets
     *  go of the log whose fibre asked for it. */
    let moving = false;
    const moveOn: Effect.Effect<void> = Effect.suspend(() => {
      const roomLog = log;
      const view = lastView;
      if (!roomLog || roomLog.encryptionKey !== null || !view || moving || config.plainLogs) return Effect.void;
      if (!view.moved && !roomLog.writable()) return Effect.void;
      moving = true;
      const work: Effect.Effect<void> = view.moved ? follow(view.moved) : Effect.log("moving the room to an encrypted log").pipe(Effect.andThen(moveRoom(roomLog, view)));
      return work.pipe(
        // a fibre of its own: what goes wrong in it is said, not lost
        Effect.catchCause((cause) => Effect.logError(`moving the room failed: ${String(cause)}`)),
        Effect.ensuring(Effect.sync(() => void (moving = false))),
        Effect.forkIn(scope),
        Effect.asVoid,
      );
    });

    /** Ask a member to admit our writer core (no-op once we're in). */
    const askToJoin = (key: string) =>
      Effect.suspend(() =>
        log && !log.writable()
          ? send(key, { kind: "join-log", writer: log.writerKey }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void))
          : Effect.void,
      );

    /** Tell one peer where the room's log lives, once per connection and per
     *  log. A no-op until we have a log — the peer hears it when we do, or
     *  when their profile arrives, whichever comes later. */
    const announceLog = (key: string) =>
      Effect.gen(function* () {
        if (announced.has(key) || !allowed(key)) return;
        const info = yield* logInfo;
        if (!info) return;
        announced.add(key);
        yield* send(key, info).pipe(Effect.catchTag("PeerNotConnected", () => Effect.sync(() => void announced.delete(key))));
        yield* askToJoin(key);
      });

    /** Introduce ourselves to one peer in this room: our profile and, if we
     *  know it, where the room's log lives. Once per connection. `hello`: our
     *  first word to them since we joined, not an answer to theirs. */
    const greet = (key: string, hello = false) =>
      Effect.gen(function* () {
        // joining with an invite: ask whoever is here to let us in
        yield* redeemWith(key);
        // a stranger to an encrypted room hears nothing about it
        if (greeted.has(key) || !allowed(key)) return;
        greeted.add(key);
        yield* send(key, { kind: "profile", profile: yield* config.getProfile, ...(hello ? { hello: true as const } : {}) });
        yield* announceLog(key);
        yield* askToJoin(key);
      }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.sync(() => void greeted.delete(key))));

    const hooks: TopicHooks = {
      greet: (key) => Effect.sync(() => void connected.add(key)).pipe(Effect.andThen(greet(key, true))),
      onPeerGone: (key) =>
        Effect.suspend(() => {
          connected.delete(key);
          greeted.delete(key);
          announced.delete(key);
          strangers.delete(key);
          if (!peers.delete(key)) return Effect.void;
          return publishRoster;
        }),
      onFrame: (key, frame) => {
        switch (frame.kind) {
          case "profile":
            // a stranger to an encrypted room: kept aside, out of the roster,
            // until an invite lets them in (we may be the one joining: ask)
            if (!allowed(key)) return Effect.sync(() => void strangers.set(key, { key, ...frame.profile })).pipe(Effect.andThen(redeemWith(key)));
            return Effect.suspend(() => {
              const known = peers.has(key);
              peers.set(key, { key, ...frame.profile });
              // back in the room without the connection dropping (they left
              // and joined again, or restarted it): they hold nothing from
              // before, so we start over — or they wait forever to be let in
              if (known && frame.hello) {
                greeted.delete(key);
                announced.delete(key);
                return Effect.log(`peer back: ${frame.profile.name} (${key.slice(0, 8)})`);
              }
              if (known) return Effect.void;
              // first profile from a peer = they are actually reachable here
              const theirs = frame.profile.protocol;
              return Effect.log(`peer online: ${frame.profile.name} (${key.slice(0, 8)})`).pipe(
                Effect.andThen(
                  theirs === PROTOCOL_VERSION
                    ? Effect.void
                    : Effect.logWarning(
                        `${frame.profile.name} runs collagen protocol ${theirs}, we run ${PROTOCOL_VERSION} — messages between you may not get through until one side updates`,
                      ),
                ),
              );
            }).pipe(
              Effect.andThen(publishRoster),
              // they found us on this topic; answer in kind (no-op if we already did)
              Effect.andThen(greet(key)),
              // the greeting may have gone out before our log existed (the
              // connection came up as the room opened): they are here now,
              // so they hear where the log is — or they would wait forever
              Effect.andThen(announceLog(key)),
            );
          case "log-info":
            return Effect.gen(function* () {
              // joining with an invite, the room is opened with the keys a
              // member hands over; an encrypted room never yields its log
              if (joining && !log) return;
              if (gated()) return;
              if (log && log.key !== frame.key) {
                // Two logs for one room: both sides started one (e.g. a room
                // from before logs existed). A log nobody else is on yields
                // to a populated one; two lonely logs keep the lower key. A
                // populated pair is a real split and stays (loudly).
                const ourMembers = (yield* SubscriptionRef.get(members)).filter((member) => member.key !== me).length;
                const theirMembers = frame.members;
                const lonely = ourMembers === 0;
                const theyAreLonely = theirMembers <= 1;
                const yieldToTheirs = lonely && (!theyAreLonely || frame.key < log.key);
                if (!yieldToTheirs) {
                  return yield* Effect.logWarning(
                    `peer ${key.slice(0, 8)} uses another log for this room (${frame.key.slice(0, 12)}…, ${theirMembers} member(s)) — keeping ours (${String(ourMembers + 1)} member(s))`,
                  );
                }
                yield* Effect.log(`abandoning our lonely log ${log.key.slice(0, 12)}… for the room's log ${frame.key.slice(0, 12)}…`);
                yield* dropLog;
              }
              if (!log) yield* attachLog(frame.key, "none");
              yield* askToJoin(key);
            });
          case "join-log":
            // served now if we can write; otherwise kept until we can — and
            // in an encrypted room, only for its members and those an invite let in
            return Effect.suspend(() => {
              if (admitted.has(frame.writer)) return Effect.void;
              if (!allowed(key)) return Effect.logWarning(`${key.slice(0, 8)} asked to write to the room without being let in — ignored`);
              pendingJoins.add(frame.writer);
              return admitPending;
            });
          case "redeem":
            return redeem(key, frame.inviteId, frame.proof);
          case "keys":
            return takeKeys(key, frame.logKey, frame.encryptionKey);
          case "refused":
            return Effect.suspend(() =>
              joining && frame.inviteId === joining.id && !log
                ? Effect.logWarning(`invite refused by ${key.slice(0, 8)}: ${frame.why}`).pipe(Effect.andThen(SubscriptionRef.set(refusal, frame.why)))
                : Effect.void,
            );
          case "drive":
            return PubSub.publish(driveRequests, { from: key, action: frame.action }).pipe(Effect.asVoid);
          case "transcript-request":
            return PubSub.publish(transcriptRequests, { from: key, request: frame }).pipe(Effect.asVoid);
          case "transcript":
            return PubSub.publish(transcripts, { from: key, transcript: frame }).pipe(Effect.asVoid);
          case "fetch-attachment":
            return PubSub.publish(fetchRequests, { from: key, attachmentId: frame.attachmentId }).pipe(Effect.asVoid);
          case "attachment":
            return PubSub.publish(attachmentsIn, { from: key, attachment: frame }).pipe(Effect.asVoid);
        }
      },
    };

    // known before joining: joining greets the peers already connected
    // through other rooms, and a greeting under no topic reaches nobody
    const topic = roomTopic(config.roomName, config.net);
    topicHex = topic.toString("hex");
    yield* swarm.join(topic, hooks);

    // A join request can land on a member who can't serve it yet (or get lost
    // with a connection); keep asking everyone present until admitted.
    // Joining with an invite, the same: keep showing it to whoever is here.
    yield* Effect.gen(function* () {
      if (!log) return yield* Effect.forEach([...connected], redeemWith, { discard: true });
      if (log.writable()) return;
      yield* Effect.forEach([...peers.keys()], askToJoin, { discard: true });
    }).pipe(Effect.schedule(Schedule.spaced("10 seconds")), Effect.forkScoped);
    // a known log: open it (one from before encryption opens as it was, and
    // moves); joining with an invite: wait to be let in; a new room: make it,
    // encrypted; a joiner from before invites: wait for a member, as before
    if (config.log.key !== null) yield* attachLog(config.log.key, config.log.encryptionKey ? { key: config.log.encryptionKey } : "none");
    else if (joining) yield* Effect.log("joining with an invite — waiting for a member to let us in");
    else if (config.log.creator) yield* attachLog(null, config.plainLogs ? "none" : "new");
    else yield* Effect.log("no log for this room yet — waiting for a member to announce it");

    const sendTo = Effect.fn("Room.sendTo")(function* (
      peerKey: string,
      payload: { project: string; intent: string; findings: string; ticketId?: string; agent?: string; conversation?: Conversation },
    ) {
      const roomLog = yield* requireLog;
      const now = yield* Clock.currentTimeMillis;
      const message: RoomMessage = {
        id: yield* Effect.sync(() => randomUUID()),
        threadId: deriveThreadId(me, peerKey, payload.project),
        from: me,
        // live profile name, not the startup snapshot — renames apply mid-run
        fromName: (yield* config.getProfile).name,
        to: peerKey,
        project: payload.project,
        intent: payload.intent,
        findings: payload.findings,
        ts: now,
        ...(payload.ticketId ? { ticketId: payload.ticketId } : {}),
        ...(payload.agent ? { agent: payload.agent } : {}),
        ...(payload.conversation ? { conversation: payload.conversation } : {}),
      };
      yield* roomLog.append({ op: "msg", msg: message }).pipe(Effect.orDie);
      return message;
    });

    /** Ask a peer to act as itself (testing; only mock peers obey). Ephemeral:
     *  the peer must be present. */
    const sendDrive = Effect.fn("Room.sendDrive")(function* (peerKey: string, action: DriveAction) {
      if (!peers.has(peerKey)) return yield* new PeerNotConnected({ peerKey });
      yield* send(peerKey, { kind: "drive", action });
    });

    /** Ask everyone present for their agent's conversation on these threads.
     *  Whether anyone answers is that person's call, in their outbox. */
    const requestTranscripts = Effect.fn("Room.requestTranscripts")(function* (request: Omit<TranscriptRequestFrame, "kind">) {
      yield* broadcast({ kind: "transcript-request", ...request });
      return peers.size;
    });

    /** Put an attachment reference on the log (the file stays with us). */
    const attach = Effect.fn("Room.attach")(function* (attachment: Attachment) {
      const roomLog = yield* requireLog;
      yield* roomLog.append({ op: "attachment", attachment }).pipe(Effect.orDie);
      yield* refresh;
    });

    /** Say a comment on a review's code, on the log — once; it never changes. */
    const comment = Effect.fn("Room.comment")(function* (reviewComment: ReviewComment) {
      const roomLog = yield* requireLog;
      yield* roomLog.append({ op: "comment", comment: reviewComment }).pipe(Effect.orDie);
      yield* refresh;
    });

    /** Hand a fetched attachment's bytes to the one who asked. */
    const sendAttachment = Effect.fn("Room.sendAttachment")(function* (peerKey: string, attachment: Omit<AttachmentFrame, "kind">) {
      if (!peers.has(peerKey)) return yield* new PeerNotConnected({ peerKey });
      yield* send(peerKey, { kind: "attachment", ...attachment });
    });

    /** Ask an attachment's holder for the file. Ephemeral: they must be present. */
    const fetchAttachment = Effect.fn("Room.fetchAttachment")(function* (holderKey: string, attachmentId: string) {
      if (!peers.has(holderKey)) return yield* new PeerNotConnected({ peerKey: holderKey });
      yield* send(holderKey, { kind: "fetch-attachment", attachmentId });
    });

    /** Hand one transcript slice to the peer who asked — their person said so.
     *  Ephemeral:
     *  they must be present. */
    const sendTranscript = Effect.fn("Room.sendTranscript")(function* (peerKey: string, transcript: Omit<TranscriptFrame, "kind">) {
      if (!peers.has(peerKey)) return yield* new PeerNotConnected({ peerKey });
      yield* send(peerKey, { kind: "transcript", ...transcript });
    });

    /** Join with an invite after all: a room we list but were never let into
     *  (no log of its own yet). Shown to everyone here at once. "in" when we
     *  are in the room already, or the invite is for another one. */
    const useInvite = (invite: Invite): Effect.Effect<"joining" | "in"> =>
      Effect.suspend(() => {
        if (log || invite.roomName !== config.roomName) return Effect.succeed("in" as const);
        joining = invite;
        return Effect.forEach([...connected], redeemWith, { discard: true }).pipe(Effect.as("joining" as const));
      });

    /** A new invite to this room: its public half goes on the log, the text
     *  to hand someone comes back. It lets one person in, within a week. */
    const createInvite = Effect.fn("Room.createInvite")(function* () {
      const roomLog = yield* requireLog;
      // a room from before encryption is moving; it takes invites once it has
      if (roomLog.encryptionKey === null) return yield* new NotWritable({ roomId: config.roomName });
      const made = newInvite(config.roomName, config.net, roomLog.key);
      const now = yield* Clock.currentTimeMillis;
      yield* roomLog.append({ op: "invite", invite: { id: made.invite.id, publicKey: made.publicKey, by: me, expires: now + INVITE_LIFETIME_MS, ts: now } }).pipe(Effect.orDie);
      return formatInvite(made.invite);
    });

    /** Rename the room for everyone: stamp now, append; the view updates all. */
    const rename = Effect.fn("Room.rename")(function* (name: string) {
      const roomLog = yield* requireLog;
      const now = yield* Clock.currentTimeMillis;
      yield* SubscriptionRef.set(meta, { name, ts: now });
      yield* roomLog.append({ op: "rename", name, ts: now }).pipe(Effect.orDie);
    });

    /** Put the why behind a review ticket on the log (its author writes it;
     *  an amendment carries the whole record and the later ts wins). */
    const shareReview = Effect.fn("Room.shareReview")(function* (review: ReviewContext) {
      const roomLog = yield* requireLog;
      yield* roomLog.append({ op: "review", review }).pipe(Effect.orDie);
      yield* refresh;
    });

    /** Put a ticket (new or changed) on the log; returns the merged record. */
    const shareTicket = Effect.fn("Room.shareTicket")(function* (ticket: Ticket) {
      const roomLog = yield* requireLog;
      yield* roomLog.append({ op: "ticket", ticket }).pipe(Effect.orDie);
      yield* refresh;
      return (yield* SubscriptionRef.get(tickets)).get(ticket.id) ?? ticket;
    });

    return {
      /** Peers present right now + changes (emits current value on subscribe). */
      roster,
      /** Everyone ever admitted to the log, by key, with the name they gave. */
      members,
      /** The room's shared display name (last-writer-wins across members). */
      meta,
      rename,
      /** Shared tickets by id (as the log's view has them) + changes. */
      tickets,
      shareTicket,
      /** The why behind each review ticket (as the log's view has it). */
      reviews,
      unseen,
      shareReview,
      /** Messages for us, in log order with their position. Each subscriber
       *  sees every one exactly once — the ones already on the log first. */
      messages: SubscriptionRef.changes(mine).pipe(
        Stream.mapAccum(
          () => -1,
          (last: number, all: ReadonlyArray<LoggedMessage>) => {
            const fresh = all.filter((message) => message.seq > last);
            return [fresh.length > 0 ? fresh[fresh.length - 1]!.seq : last, fresh] as const;
          },
        ),
      ),
      /** Every message in the room, in log order — the a2a trace. */
      trace,
      /** Put a directed message on the log; the recipient reads it whenever
       *  they are next online. Fails typed until we're admitted to the log. */
      sendTo,
      /** Drive requests addressed to us (testing; policy is the app's call). */
      drives: Stream.fromPubSub(driveRequests),
      sendDrive,
      /** Peers asking for our agent's conversations (the app gates them). */
      transcriptRequests: Stream.fromPubSub(transcriptRequests),
      /** Conversations peers handed us because their person said so. */
      transcripts: Stream.fromPubSub(transcripts),
      requestTranscripts,
      sendTranscript,
      /** Comments on reviews' code, as the log has them. */
      comments,
      comment,
      /** Files attached to the room's tickets — references from the log. */
      attachments,
      attach,
      /** Peers asking us for an attachment we hold. */
      fetchRequests: Stream.fromPubSub(fetchRequests),
      fetchAttachment,
      /** Attachments arriving because we fetched them. */
      attachmentsIn: Stream.fromPubSub(attachmentsIn),
      sendAttachment,
      /** Re-broadcast the local profile to all present peers (after a settings change). */
      updateProfile: Effect.gen(function* () {
        yield* broadcast({ kind: "profile", profile: yield* config.getProfile });
      }).pipe(Effect.withSpan("Room.broadcastProfile")),
      /** The log's key once known (persist it: it's how we reopen the room alone). */
      logKey,
      /** The key that reads the log (persist it beside the log's key). */
      encryptionKey,
      /** Why our invite was turned down, or why we cannot follow the room; null when nothing stands in the way. */
      refusal,
      /** A new invite to hand someone: lets one person in, within a week. */
      createInvite,
      /** Join with an invite a room we list but were never let into. */
      useInvite,
      /** Whether we can write to the room's log yet. */
      writable,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
