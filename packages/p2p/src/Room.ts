import { createHash, randomUUID } from "node:crypto";
import { Clock, Context, Effect, Layer, PubSub, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import Hyperswarm from "hyperswarm";
import b4a from "b4a";
import { FrameFromJson, type Bootstrap, type Frame, type Peer, type RoomMessage, type SharedProfile } from "./schema";
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
  /** Re-evaluated on every broadcast, so profile changes are picked up live. */
  readonly getProfile: Effect.Effect<SharedProfile>;
  readonly bootstrap?: Bootstrap;
}>()("p2p/RoomConfig") {}

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
    const inbound = yield* Effect.acquireRelease(
      PubSub.unbounded<RoomMessage>(),
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
        Effect.catch((e) => Effect.logDebug(`frame write failed: ${String(e)}`)),
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

    const handleFrame = (key: string, frame: Frame) =>
      frame.kind === "profile"
        ? Effect.sync(() => {
            peers.set(key, { key, ...frame.profile });
          }).pipe(Effect.andThen(publishRoster))
        : frame.kind === "msg"
          ? PubSub.publish(inbound, frame.msg)
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
        connByKey.delete(key);
        peers.delete(key);
        runFork(publishRoster);
      });
      // greet with our current profile and every ticket we know, so a
      // late joiner reconstructs the shared state from any one peer
      runFork(config.getProfile.pipe(Effect.flatMap((p) => writeFrame(conn, { kind: "profile", profile: p }))));
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
        fromName: config.identity.name,
        project: payload.project,
        intent: payload.intent,
        findings: payload.findings,
        ts,
      };
      yield* writeFrame(conn, { kind: "msg", msg });
      return msg;
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
      /** Shared tickets by id (merged copies) + changes. */
      tickets,
      shareTicket,
      /** Every directed message addressed to us. Each subscription sees all. */
      messages: Stream.fromPubSub(inbound),
      /** Send a directed message; fails typed if the peer isn't connected. */
      sendTo,
      /** Re-broadcast the local profile to all peers (after a settings change). */
      updateProfile: broadcastProfile,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
