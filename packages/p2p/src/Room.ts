import { createHash, randomUUID } from "node:crypto";
import { Clock, Context, Effect, PubSub, Runtime, Schema, Stream, SubscriptionRef } from "effect";
import Hyperswarm from "hyperswarm";
import b4a from "b4a";
import { FrameFromJson, type Bootstrap, type Frame, type Peer, type RoomMessage, type SharedProfile } from "./schema";
import { PeerNotConnected } from "./errors";
import { roomTopic } from "./topic";
import type { Identity } from "./types";

/** Conversation key — symmetric (sorted keys), so A→B and B→A land in the
 *  same thread and replies continue the same AI session on both sides. */
export function deriveThreadId(a: string, b: string, project: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return createHash("sha256").update(`${lo}|${hi}|${project}`).digest("hex").slice(0, 16);
}

export class RoomConfig extends Context.Tag("p2p/RoomConfig")<
  RoomConfig,
  {
    readonly identity: Identity;
    readonly roomName: string;
    /** Re-evaluated on every broadcast, so profile changes are picked up live. */
    readonly getProfile: Effect.Effect<SharedProfile>;
    readonly bootstrap?: Bootstrap;
  }
>() {}

const decodeFrame = Schema.decodeUnknown(FrameFromJson);
const encodeFrame = Schema.encode(FrameFromJson);

/**
 * A room on the swarm: exchanges presence profiles AND carries directed
 * messages over the same connections. Live-only (no offline queue yet).
 */
export class Room extends Effect.Service<Room>()("p2p/Room", {
  scoped: Effect.gen(function* () {
    const config = yield* RoomConfig;
    const runtime = yield* Effect.runtime<never>();
    const runFork = Runtime.runFork(runtime);

    const roster = yield* SubscriptionRef.make<ReadonlyArray<Peer>>([]);
    const inbound = yield* Effect.acquireRelease(
      PubSub.unbounded<RoomMessage>(),
      (p) => PubSub.shutdown(p),
    );

    // Mutable connection/peer books — only touched from swarm callbacks and
    // effects, never exposed.
    const connByKey = new Map<string, any>();
    const peers = new Map<string, Peer>();
    const publishRoster = Effect.suspend(() => SubscriptionRef.set(roster, [...peers.values()]));

    const swarm = yield* Effect.acquireRelease(
      Effect.sync(() => new Hyperswarm({ keyPair: config.identity.keyPair, bootstrap: config.bootstrap })),
      (s) => Effect.promise(() => s.destroy() as Promise<void>).pipe(Effect.orDie),
    );

    // Serialize + write one frame to one connection; failures are logged, not fatal
    // (peer mid-teardown behaves like a lost packet, same as before).
    const writeFrame = (conn: any, frame: Frame) =>
      encodeFrame(frame).pipe(
        Effect.flatMap((json) => Effect.try(() => void conn.write(b4a.from(json)))),
        Effect.catchAll((e) => Effect.logDebug(`frame write failed: ${String(e)}`)),
      );

    const broadcastProfile = Effect.gen(function* () {
      const profile = yield* config.getProfile;
      const frame: Frame = { kind: "profile", profile };
      yield* Effect.forEach([...connByKey.values()], (conn) => writeFrame(conn, frame), {
        discard: true,
      });
    });

    const handleFrame = (key: string, frame: Frame) =>
      frame.kind === "profile"
        ? Effect.sync(() => {
            peers.set(key, { key, ...frame.profile });
          }).pipe(Effect.andThen(publishRoster))
        : PubSub.publish(inbound, frame.msg);

    const onData = (key: string, data: Buffer) =>
      decodeFrame(b4a.toString(data)).pipe(
        Effect.flatMap((frame) => handleFrame(key, frame)),
        Effect.catchTag("ParseError", (e) =>
          Effect.logWarning(`dropped invalid frame from ${key.slice(0, 8)}: ${e.message.slice(0, 120)}`),
        ),
      );

    swarm.on("connection", (conn: any, info: { publicKey: Buffer }) => {
      const key = b4a.toString(info.publicKey, "hex");
      connByKey.set(key, conn);
      conn.on("error", () => {});
      conn.on("data", (d: Buffer) => runFork(onData(key, d)));
      conn.on("close", () => {
        connByKey.delete(key);
        peers.delete(key);
        runFork(publishRoster);
      });
      // greet with our current profile
      runFork(config.getProfile.pipe(Effect.flatMap((p) => writeFrame(conn, { kind: "profile", profile: p }))));
    });

    const discovery = swarm.join(roomTopic(config.roomName), { server: true, client: true });
    // Fire-and-forget: flushed() resolves when fully announced; not required for readiness.
    yield* Effect.promise(() => discovery.flushed() as Promise<void>).pipe(
      Effect.timeout("10 seconds"),
      Effect.ignore,
      Effect.forkScoped,
    );

    const sendTo = (
      peerKey: string,
      payload: { project: string; intent: string; findings: string },
    ): Effect.Effect<RoomMessage, PeerNotConnected> =>
      Effect.gen(function* () {
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

    return {
      /** Current peers + changes (emits current value on subscribe). */
      roster,
      /** Every directed message addressed to us. Each subscription sees all. */
      messages: Stream.fromPubSub(inbound),
      /** Send a directed message; fails typed if the peer isn't connected. */
      sendTo,
      /** Re-broadcast the local profile to all peers (after a settings change). */
      updateProfile: broadcastProfile,
    } as const;
  }),
}) {}
