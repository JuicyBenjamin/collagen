import { createHash, randomUUID } from "node:crypto";
import { Clock, Context, Effect, Layer, PubSub, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import Hyperswarm from "hyperswarm";
import b4a from "b4a";
import { FrameFromJson, type Bootstrap, type DriveAction, type Frame, type Peer, type RoomMessage, type SharedProfile } from "./schema";
import { PeerNotConnected } from "./errors";
import { mergeTicket, type Ticket } from "./ticket";
import { roomTopic } from "./topic";
import type { Identity } from "./types";

/** Conversation key — symmetric (sorted keys), so A→B and B→A land in the
 *  same thread and replies continue the same AI session on both sides. */
export function deriveThreadId(a: string, b: string, project: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return createHash("sha256").update(`${lo}|${hi}|${project}`).digest("hex").slice(0, 16);
}

export class RoomConfig extends Context.Service<RoomConfig, {
  readonly identity: Identity;
  readonly roomName: string;
  /** The room's shared display name + when it was last set (0 = never shared:
   *  a local default that any broadcast name overrides). */
  readonly roomLabel: RoomMeta;
  /** Re-evaluated on every broadcast, so profile changes are picked up live. */
  readonly getProfile: Effect.Effect<SharedProfile>;
  readonly bootstrap?: Bootstrap;
}>()("p2p/RoomConfig") {}

export interface RoomMeta {
  readonly name: string;
  readonly ts: number;
}

const decodeFrame = Schema.decodeUnknownEffect(FrameFromJson);
const encodeFrame = Schema.encodeEffect(FrameFromJson);

/** Minimal structural view of a hyperswarm connection (the lib ships no types). */
interface SwarmConnection {
  write(data: Uint8Array): void;
  on(event: "data", cb: (data: Uint8Array) => void): SwarmConnection;
  on(event: "error" | "close", cb: () => void): SwarmConnection;
}

/**
 * A room on the swarm: exchanges presence profiles AND carries directed
 * messages over the same connections. Live-only (no offline queue yet).
 */
export class Room extends Context.Service<Room>()("p2p/Room", {
  make: Effect.gen(function* () {
    const config = yield* RoomConfig;
    // Captures the full service map (loggers included) so swarm callbacks
    // fork effects into the same environment.
    const services = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(services);

    const roster = yield* SubscriptionRef.make<ReadonlyArray<Peer>>([]);
    const tickets = yield* SubscriptionRef.make<ReadonlyMap<string, Ticket>>(new Map());
    const meta = yield* SubscriptionRef.make<RoomMeta>(config.roomLabel);
    // Outbound trace (last 100) — the UI's message log shows both directions.
    const sent = yield* SubscriptionRef.make<ReadonlyArray<RoomMessage>>([]);
    const inbound = yield* Effect.acquireRelease(
      PubSub.unbounded<RoomMessage>(),
      (p) => PubSub.shutdown(p),
    );
    const driveRequests = yield* Effect.acquireRelease(
      PubSub.unbounded<{ from: string; action: DriveAction }>(),
      (p) => PubSub.shutdown(p),
    );

    // Mutable connection/peer books — only touched from swarm callbacks and
    // effects, never exposed.
    const connByKey = new Map<string, SwarmConnection>();
    const peers = new Map<string, Peer>();
    const publishRoster = Effect.suspend(() => SubscriptionRef.set(roster, [...peers.values()]));

    const swarm = yield* Effect.acquireRelease(
      Effect.sync(() => new Hyperswarm({ keyPair: config.identity.keyPair, bootstrap: config.bootstrap })),
      (s) => Effect.promise(() => s.destroy() as Promise<void>).pipe(Effect.orDie),
    );

    // Serialize + write one frame to one connection; failures are logged, not fatal
    // (peer mid-teardown behaves like a lost packet, same as before).
    const writeFrame = (conn: SwarmConnection, frame: Frame) =>
      encodeFrame(frame).pipe(
        Effect.flatMap((json) => Effect.sync(() => void conn.write(b4a.from(json)))),
        // warn, not debug: a silently dropped frame looks exactly like "peer
        // never answered" and has cost hours of misdiagnosis
        Effect.catch((e) => Effect.logWarning(`frame write failed (${frame.kind}): ${String(e).slice(0, 160)}`)),
      );

    const broadcastProfile = Effect.gen(function* () {
      const profile = yield* config.getProfile;
      const frame: Frame = { kind: "profile", profile };
      yield* Effect.forEach([...connByKey.values()], (conn) => writeFrame(conn, frame), {
        discard: true,
      });
    }).pipe(Effect.withSpan("Room.broadcastProfile"));

    const absorbTicket = (incoming: Ticket) =>
      SubscriptionRef.update(tickets, (m) => {
        const next = new Map(m);
        const mine = next.get(incoming.id);
        next.set(incoming.id, mine ? mergeTicket(mine, incoming) : incoming);
        return next;
      });

    // Last-writer-wins: a newer ts replaces the name everywhere.
    const absorbMeta = (incoming: RoomMeta) =>
      Effect.logDebug(`room-meta received: "${incoming.name}" ts=${incoming.ts}`).pipe(
        Effect.andThen(SubscriptionRef.update(meta, (cur) => (incoming.ts > cur.ts ? incoming : cur))),
      );

    const handleFrame = (key: string, frame: Frame) =>
      frame.kind === "profile"
        ? Effect.suspend(() => {
            const known = peers.has(key);
            peers.set(key, { key, ...frame.profile });
            // first profile from a connection = the peer is actually reachable
            // (a bare "swarm connection" can be half-open and carry nothing)
            return known ? Effect.void : Effect.log(`peer online: ${frame.profile.name} (${key.slice(0, 8)})`);
          }).pipe(Effect.andThen(publishRoster))
        : frame.kind === "msg"
          ? PubSub.publish(inbound, frame.msg)
          : frame.kind === "room-meta"
            ? absorbMeta({ name: frame.name, ts: frame.ts })
            : frame.kind === "drive"
              ? PubSub.publish(driveRequests, { from: key, action: frame.action })
              : absorbTicket(frame.ticket);

    const onData = (key: string, data: Uint8Array) =>
      decodeFrame(b4a.toString(data)).pipe(
        Effect.flatMap((frame) => handleFrame(key, frame)),
        Effect.catchTag("SchemaError", (e) =>
          Effect.logWarning(`dropped invalid frame from ${key.slice(0, 8)}: ${String(e.issue).slice(0, 120)}`),
        ),
      );

    swarm.on("connection", (conn: SwarmConnection, info: { publicKey: Buffer }) => {
      const key = b4a.toString(info.publicKey, "hex");
      runFork(Effect.log(`swarm connection: ${key.slice(0, 12)}`));
      connByKey.set(key, conn);
      conn.on("error", () => {});
      conn.on("data", (d) => runFork(onData(key, d)));
      conn.on("close", () => {
        // A replacement connection for the same peer may already be in the
        // book (hyperswarm reconnects overlap) — only forget the peer if the
        // closing connection is still the current one.
        if (connByKey.get(key) === conn) {
          connByKey.delete(key);
          peers.delete(key);
          runFork(publishRoster);
        }
      });
      // greet with our current profile, the room's shared name, and every
      // ticket we know, so a late joiner reconstructs the shared state from
      // any one peer
      runFork(config.getProfile.pipe(Effect.flatMap((p) => writeFrame(conn, { kind: "profile", profile: p }))));
      runFork(
        SubscriptionRef.get(meta).pipe(
          Effect.flatMap((m) =>
            m.ts > 0
              ? Effect.logDebug(`greeting with room-meta "${m.name}"`).pipe(
                  Effect.andThen(writeFrame(conn, { kind: "room-meta", name: m.name, ts: m.ts })),
                )
              : Effect.void,
          ),
        ),
      );
      runFork(
        SubscriptionRef.get(tickets).pipe(
          Effect.flatMap((m) =>
            Effect.forEach([...m.values()], (ticket) => writeFrame(conn, { kind: "ticket", ticket }), {
              discard: true,
            }),
          ),
        ),
      );
    });

    const discovery = swarm.join(roomTopic(config.roomName), { server: true, client: true });
    // Fire-and-forget: flushed() resolves when fully announced; not required for readiness.
    yield* Effect.promise(() => discovery.flushed() as Promise<void>).pipe(
      Effect.timeout("10 seconds"),
      Effect.ignore,
      Effect.forkScoped,
    );
    // Peers that join in the same instant can miss each other: each side's
    // topic lookup can run before the other side's announce lands, and
    // hyperswarm's own re-lookup is too infrequent to recover quickly.
    // Periodically re-running announce+lookup makes the room converge.
    yield* Effect.promise(() => discovery.refresh({ client: true, server: true }) as Promise<void>).pipe(
      Effect.ignore,
      Effect.schedule(Schedule.spaced("15 seconds")),
      Effect.forkScoped,
    );

    const sendTo = Effect.fn("Room.sendTo")(function* (
      peerKey: string,
      payload: { project: string; intent: string; findings: string },
    ) {
      const conn = connByKey.get(peerKey);
      if (!conn) return yield* new PeerNotConnected({ peerKey });
      const ts = yield* Clock.currentTimeMillis;
      const msg: RoomMessage = {
        id: yield* Effect.sync(() => randomUUID()),
        threadId: deriveThreadId(config.identity.pubkey, peerKey, payload.project),
        from: config.identity.pubkey,
        // live profile name, not the startup snapshot — renames apply mid-run
        fromName: (yield* config.getProfile).name,
        project: payload.project,
        intent: payload.intent,
        findings: payload.findings,
        ts,
      };
      yield* writeFrame(conn, { kind: "msg", msg });
      yield* SubscriptionRef.update(sent, (s) => [...s.slice(-99), msg]);
      return msg;
    });

    /** Ask a peer to act as itself (testing; only mock peers obey). */
    const sendDrive = Effect.fn("Room.sendDrive")(function* (peerKey: string, action: DriveAction) {
      const conn = connByKey.get(peerKey);
      if (!conn) return yield* new PeerNotConnected({ peerKey });
      yield* writeFrame(conn, { kind: "drive", action });
    });

    /** Rename the room for everyone: stamp now, set locally, broadcast. */
    const rename = Effect.fn("Room.rename")(function* (name: string) {
      const ts = yield* Clock.currentTimeMillis;
      yield* SubscriptionRef.set(meta, { name, ts });
      const frame: Frame = { kind: "room-meta", name, ts };
      yield* Effect.log(`rename → "${name}", broadcasting to ${connByKey.size} conn(s)`);
      yield* Effect.forEach([...connByKey.values()], (conn) => writeFrame(conn, frame), {
        discard: true,
      });
    });

    /** Merge a ticket locally and broadcast the merged copy to the room. */
    const shareTicket = Effect.fn("Room.shareTicket")(function* (ticket: Ticket) {
      yield* absorbTicket(ticket);
      const merged = (yield* SubscriptionRef.get(tickets)).get(ticket.id) ?? ticket;
      const frame: Frame = { kind: "ticket", ticket: merged };
      yield* Effect.forEach([...connByKey.values()], (conn) => writeFrame(conn, frame), {
        discard: true,
      });
      return merged;
    });

    return {
      /** Current peers + changes (emits current value on subscribe). */
      roster,
      /** The room's shared display name (last-writer-wins across peers). */
      meta,
      rename,
      /** Shared tickets by id (merged copies) + changes. */
      tickets,
      shareTicket,
      /** Every directed message addressed to us. Each subscription sees all. */
      messages: Stream.fromPubSub(inbound),
      /** Messages we sent (recent ring) — for the UI's a2a trace. */
      sent,
      /** Send a directed message; fails typed if the peer isn't connected. */
      sendTo,
      /** Drive requests addressed to us (testing; policy is the app's call). */
      drives: Stream.fromPubSub(driveRequests),
      sendDrive,
      /** Re-broadcast the local profile to all peers (after a settings change). */
      updateProfile: broadcastProfile,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
