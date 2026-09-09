import { randomUUID } from "node:crypto";
import { Clock, Context, Effect, Exit, Layer, PubSub, Schedule, Scope, Stream, SubscriptionRef } from "effect";
import {
  PROTOCOL_VERSION,
  type DriveAction,
  type Frame,
  type Member,
  type Peer,
  type RoomMessage,
  type SharedProfile,
  type TranscriptFrame,
  type TranscriptRequestFrame,
} from "./schema";
import { NotWritable, PeerNotConnected } from "./errors";
import type { Ticket } from "./ticket";
import { deriveThreadId, roomTopic } from "./topic";
import { openRoomLog, type RoomLog } from "./RoomLog";
import { Swarm, type TopicHooks } from "./Swarm";

export class RoomConfig extends Context.Service<RoomConfig, {
  readonly roomName: string;
  /** The room's display name as we last knew it (shown until the log says otherwise). */
  readonly roomLabel: RoomMeta;
  /** Re-evaluated on every broadcast, so profile changes are picked up live. */
  readonly getProfile: Effect.Effect<SharedProfile>;
  /** The room's log: its key if we know it (persisted after the first time),
   *  and whether we created the room — the creator bootstraps the log; a
   *  joiner waits to hear the key from a member. */
  readonly log: { readonly key: string | null; readonly creator: boolean };
}>()("p2p/RoomConfig") {}

export interface RoomMeta {
  readonly name: string;
  readonly ts: number;
}

/** A message on the room's log, with its position (the inbox cursor unit). */
export interface LoggedMessage {
  readonly seq: number;
  readonly msg: RoomMessage;
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
    const writable = yield* SubscriptionRef.make(false);
    // Messages addressed to us, as the view has them. Consumers subscribe to
    // `messages`, which replays these and then follows — a PubSub would drop
    // whatever the log already held before anyone was listening.
    const mine = yield* SubscriptionRef.make<ReadonlyArray<LoggedMessage>>([]);
    const driveRequests = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; action: DriveAction }>(),
      (p) => PubSub.shutdown(p),
    );
    // Transcript diagnostics: asks arrive here (the app puts them in the
    // person's outbox), answers arrive here (the app files them). Both direct.
    const transcriptRequests = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; request: TranscriptRequestFrame }>(),
      (p) => PubSub.shutdown(p),
    );
    const transcripts = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; transcript: TranscriptFrame }>(),
      (p) => PubSub.shutdown(p),
    );

    // Peers present in THIS room (they greeted us here), whom we greeted, and
    // which joiners we already admitted. Only touched from effects.
    const peers = new Map<string, Peer>();
    const greeted = new Set<string>();
    const admitted = new Set<string>();
    // join requests we couldn't serve yet (no log, or not admitted ourselves)
    const pendingJoins = new Set<string>();
    let log: RoomLog | null = null;
    let logScope: Scope.Closeable | null = null;
    const publishRoster = Effect.suspend(() => SubscriptionRef.set(roster, [...peers.values()]));

    let topicHex = "";
    const send = (key: string, frame: Frame) => swarm.write(key, topicHex, frame);
    /** To everyone present; a peer that vanished mid-write is skipped. */
    const broadcast = (frame: Frame) =>
      Effect.forEach([...peers.keys()], (key) => send(key, frame).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void)), {
        discard: true,
      });

    const requireLog = Effect.suspend(() =>
      log && log.writable() ? Effect.succeed(log) : Effect.fail(new NotWritable({ roomId: config.roomName })),
    );

    /** Re-read the view into the refs; publish messages for us not seen yet. */
    const refresh = Effect.gen(function* () {
      if (!log) return;
      const view = yield* log.read;
      yield* Effect.logDebug(
        `log view: ${view.tickets.length} ticket(s) · ${view.messages.length} message(s) · ${view.members.length} member(s) · writable=${String(log.writable())}`,
      );
      yield* SubscriptionRef.set(tickets, new Map(view.tickets.map((t) => [t.id, t])));
      yield* SubscriptionRef.set(members, view.members);
      yield* SubscriptionRef.set(trace, view.messages.map((m) => m.msg));
      const name = view.name;
      if (name) yield* SubscriptionRef.update(meta, (cur) => (name.ts > cur.ts ? name : cur));
      yield* SubscriptionRef.set(writable, log.writable());
      yield* SubscriptionRef.set(mine, view.messages.filter((m) => m.msg.to === me));
    });

    /** Admit everyone who asked while we couldn't. */
    const admitPending = Effect.gen(function* () {
      const l = log;
      if (!l || !l.writable()) return;
      for (const writer of [...pendingJoins]) {
        pendingJoins.delete(writer);
        if (admitted.has(writer)) continue;
        admitted.add(writer);
        yield* Effect.log(`admitting ${writer.slice(0, 8)} to the room log`);
        yield* l.append({ op: "add-writer", key: writer }).pipe(
          Effect.catch((e) => Effect.logWarning(`admit failed: ${e.message}`)),
        );
      }
    });

    /** Say who we are on the log — once we can write to it. The creator also
     *  puts the room's name there the first time, so a room named before the
     *  log existed (or named at creation) reaches joiners by name. */
    const introduce = Effect.gen(function* () {
      if (!log || !log.writable()) return;
      const profile = yield* config.getProfile;
      const ts = yield* Clock.currentTimeMillis;
      yield* log.append({ op: "member", key: me, name: profile.name, ts }).pipe(Effect.ignore);
      const view = yield* log.read;
      const label = config.roomLabel;
      if (config.log.creator && view.name === null && label.ts > 0) {
        yield* log.append({ op: "rename", name: label.name, ts: label.ts }).pipe(Effect.ignore);
      }
    });

    const logInfo = Effect.gen(function* () {
      const l = log;
      if (!l) return null;
      const count = (yield* SubscriptionRef.get(members)).length;
      const frame: Frame = { kind: "log-info", key: l.key, members: count };
      return frame;
    });

    /** Let go of the log we hold (to adopt another one). */
    const dropLog = Effect.gen(function* () {
      if (logScope) yield* Scope.close(logScope, Exit.void);
      log = null;
      logScope = null;
      yield* SubscriptionRef.set(writable, false);
      yield* SubscriptionRef.set(mine, []);
    });

    /** Bring the log up (create it, or open a key we learned) and follow it. */
    const attachLog = (key: string | null) =>
      Effect.gen(function* () {
        if (log) return;
        const child = yield* Scope.fork(scope);
        const opened = yield* openRoomLog(swarm.store, config.roomName, key).pipe(
          Effect.provideService(Scope.Scope, child),
        );
        log = opened;
        logScope = child;
        yield* SubscriptionRef.set(logKey, opened.key);
        yield* Effect.log(`room log ${key ? "opened" : "created"}: ${opened.key.slice(0, 12)}… writable=${String(opened.writable())}`);
        yield* refresh;
        yield* introduce;
        yield* admitPending;
        let wasWritable = opened.writable();
        yield* opened.changes.pipe(
          Stream.tap(() =>
            Effect.gen(function* () {
              yield* refresh;
              if (!wasWritable && opened.writable()) {
                wasWritable = true;
                yield* Effect.log("admitted to the room log");
                yield* introduce;
                yield* admitPending;
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkIn(child),
        );
        // tell everyone present where the log is
        const info = yield* logInfo;
        if (info) yield* broadcast(info);
      });

    /** Ask a member to admit our writer core (no-op once we're in). */
    const askToJoin = (key: string) =>
      Effect.suspend(() =>
        log && !log.writable()
          ? send(key, { kind: "join-log", writer: log.writerKey }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void))
          : Effect.void,
      );

    /** Introduce ourselves to one peer in this room: our profile and, if we
     *  know it, where the room's log lives. Once per connection. */
    const greet = (key: string) =>
      Effect.gen(function* () {
        if (greeted.has(key)) return;
        greeted.add(key);
        yield* send(key, { kind: "profile", profile: yield* config.getProfile });
        const info = yield* logInfo;
        if (info) yield* send(key, info);
        yield* askToJoin(key);
      }).pipe(Effect.catchTag("PeerNotConnected", () => Effect.sync(() => void greeted.delete(key))));

    const hooks: TopicHooks = {
      greet,
      onPeerGone: (key) =>
        Effect.suspend(() => {
          greeted.delete(key);
          if (!peers.delete(key)) return Effect.void;
          return publishRoster;
        }),
      onFrame: (key, frame) => {
        switch (frame.kind) {
          case "profile":
            return Effect.suspend(() => {
              const known = peers.has(key);
              peers.set(key, { key, ...frame.profile });
              if (known) return Effect.void;
              // first profile from a peer = they are actually reachable here
              const theirs = frame.profile.protocol ?? "pre-1";
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
            );
          case "log-info":
            return Effect.gen(function* () {
              if (log && log.key !== frame.key) {
                // Two logs for one room: both sides started one (e.g. a room
                // from before logs existed). A log nobody else is on yields
                // to a populated one; two lonely logs keep the lower key. A
                // populated pair is a real split and stays (loudly).
                const ourMembers = (yield* SubscriptionRef.get(members)).filter((m) => m.key !== me).length;
                const theirMembers = frame.members ?? 1;
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
              if (!log) yield* attachLog(frame.key);
              yield* askToJoin(key);
            });
          case "join-log":
            // served now if we can write; otherwise kept until we can
            return Effect.suspend(() => {
              if (admitted.has(frame.writer)) return Effect.void;
              pendingJoins.add(frame.writer);
              return admitPending;
            });
          case "drive":
            return PubSub.publish(driveRequests, { from: key, action: frame.action }).pipe(Effect.asVoid);
          case "transcript-request":
            return PubSub.publish(transcriptRequests, { from: key, request: frame }).pipe(Effect.asVoid);
          case "transcript":
            return PubSub.publish(transcripts, { from: key, transcript: frame }).pipe(Effect.asVoid);
        }
      },
    };

    topicHex = yield* swarm.join(roomTopic(config.roomName), hooks);

    // A join request can land on a member who can't serve it yet (or get lost
    // with a connection); keep asking everyone present until admitted.
    yield* Effect.gen(function* () {
      if (!log || log.writable()) return;
      yield* Effect.forEach([...peers.keys()], askToJoin, { discard: true });
    }).pipe(Effect.schedule(Schedule.spaced("10 seconds")), Effect.forkScoped);
    // creator: the log is ours to make; joiner with a remembered key: open it;
    // fresh joiner: wait for a member's log-info
    if (config.log.creator || config.log.key !== null) yield* attachLog(config.log.key);
    else yield* Effect.log("no log for this room yet — waiting for a member to announce it");

    const sendTo = Effect.fn("Room.sendTo")(function* (
      peerKey: string,
      payload: { project: string; intent: string; findings: string; ticketId?: string },
    ) {
      const l = yield* requireLog;
      const ts = yield* Clock.currentTimeMillis;
      const msg: RoomMessage = {
        id: yield* Effect.sync(() => randomUUID()),
        threadId: deriveThreadId(me, peerKey, payload.project),
        from: me,
        // live profile name, not the startup snapshot — renames apply mid-run
        fromName: (yield* config.getProfile).name,
        to: peerKey,
        project: payload.project,
        intent: payload.intent,
        findings: payload.findings,
        ts,
        ...(payload.ticketId ? { ticketId: payload.ticketId } : {}),
      };
      yield* l.append({ op: "msg", msg }).pipe(Effect.orDie);
      return msg;
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

    /** Hand one approved transcript slice to the peer who asked. Ephemeral:
     *  they must be present. */
    const sendTranscript = Effect.fn("Room.sendTranscript")(function* (peerKey: string, transcript: Omit<TranscriptFrame, "kind">) {
      if (!peers.has(peerKey)) return yield* new PeerNotConnected({ peerKey });
      yield* send(peerKey, { kind: "transcript", ...transcript });
    });

    /** Rename the room for everyone: stamp now, append; the view updates all. */
    const rename = Effect.fn("Room.rename")(function* (name: string) {
      const l = yield* requireLog;
      const ts = yield* Clock.currentTimeMillis;
      yield* SubscriptionRef.set(meta, { name, ts });
      yield* l.append({ op: "rename", name, ts }).pipe(Effect.orDie);
    });

    /** Put a ticket (new or changed) on the log; returns the merged record. */
    const shareTicket = Effect.fn("Room.shareTicket")(function* (ticket: Ticket) {
      const l = yield* requireLog;
      yield* l.append({ op: "ticket", ticket }).pipe(Effect.orDie);
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
      /** Messages for us, in log order with their position. Each subscriber
       *  sees every one exactly once — the ones already on the log first. */
      messages: SubscriptionRef.changes(mine).pipe(
        Stream.mapAccum(
          () => -1,
          (last: number, all: ReadonlyArray<LoggedMessage>) => {
            const fresh = all.filter((m) => m.seq > last);
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
      /** Conversations peers handed us after their person approved. */
      transcripts: Stream.fromPubSub(transcripts),
      requestTranscripts,
      sendTranscript,
      /** Re-broadcast the local profile to all present peers (after a settings change). */
      updateProfile: Effect.gen(function* () {
        yield* broadcast({ kind: "profile", profile: yield* config.getProfile });
      }).pipe(Effect.withSpan("Room.broadcastProfile")),
      /** The log's key once known (persist it: it's how we reopen the room alone). */
      logKey,
      /** Whether we can write to the room's log yet. */
      writable,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
