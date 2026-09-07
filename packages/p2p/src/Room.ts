import { randomUUID } from "node:crypto";
import { Clock, Context, Effect, Layer, PubSub, Stream, SubscriptionRef } from "effect";
import type { DriveAction, Frame, Peer, RoomMessage, SharedProfile } from "./schema";
import { PeerNotConnected } from "./errors";
import { mergeTicket, type Ticket } from "./ticket";
import { deriveThreadId, roomTopic } from "./topic";
import { Swarm, type TopicHooks } from "./Swarm";

export class RoomConfig extends Context.Service<RoomConfig, {
  readonly roomName: string;
  /** The room's shared display name + when it was last set (0 = never shared:
   *  a local default that any broadcast name overrides). */
  readonly roomLabel: RoomMeta;
  /** Re-evaluated on every broadcast, so profile changes are picked up live. */
  readonly getProfile: Effect.Effect<SharedProfile>;
}>()("p2p/RoomConfig") {}

export interface RoomMeta {
  readonly name: string;
  readonly ts: number;
}

/**
 * A room: one topic on the identity's swarm. Exchanges presence profiles AND
 * carries directed messages, tickets and the shared name over the swarm's
 * connections, addressed to this room. Live-only (no offline queue yet).
 */
export class Room extends Context.Service<Room>()("p2p/Room", {
  make: Effect.gen(function* () {
    const config = yield* RoomConfig;
    const swarm = yield* Swarm;
    const me = swarm.identity.pubkey;

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

    // Peers present in THIS room (they greeted us here) and whom we greeted.
    // Only touched from swarm callbacks and effects, never exposed.
    const peers = new Map<string, Peer>();
    const greeted = new Set<string>();
    const publishRoster = Effect.suspend(() => SubscriptionRef.set(roster, [...peers.values()]));

    let topicHex = "";
    const send = (key: string, frame: Frame) => swarm.write(key, topicHex, frame);
    /** To everyone in the room; a peer that vanished mid-write is skipped. */
    const broadcast = (frame: Frame) =>
      Effect.forEach([...peers.keys()], (key) => send(key, frame).pipe(Effect.catchTag("PeerNotConnected", () => Effect.void)), {
        discard: true,
      });

    const broadcastProfile = Effect.gen(function* () {
      const profile = yield* config.getProfile;
      yield* broadcast({ kind: "profile", profile });
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

    /** Introduce ourselves to one peer in this room: our profile, the room's
     *  shared name, and every ticket we know, so a late joiner reconstructs
     *  the shared state from any one peer. Once per connection. */
    const greet = (key: string) =>
      Effect.gen(function* () {
        if (greeted.has(key)) return;
        greeted.add(key);
        const profile = yield* config.getProfile;
        yield* send(key, { kind: "profile", profile });
        const m = yield* SubscriptionRef.get(meta);
        if (m.ts > 0) yield* send(key, { kind: "room-meta", name: m.name, ts: m.ts });
        for (const ticket of (yield* SubscriptionRef.get(tickets)).values()) yield* send(key, { kind: "ticket", ticket });
      }).pipe(
        Effect.catchTag("PeerNotConnected", () => Effect.sync(() => void greeted.delete(key))),
      );

    const hooks: TopicHooks = {
      greet,
      onPeerGone: (key) =>
        Effect.suspend(() => {
          greeted.delete(key);
          if (!peers.delete(key)) return Effect.void;
          return publishRoster;
        }),
      onFrame: (key, frame) =>
        frame.kind === "profile"
          ? Effect.suspend(() => {
              const known = peers.has(key);
              peers.set(key, { key, ...frame.profile });
              // first profile from a peer = they are actually reachable here
              return known ? Effect.void : Effect.log(`peer online: ${frame.profile.name} (${key.slice(0, 8)})`);
            }).pipe(
              Effect.andThen(publishRoster),
              // they found us on this topic; answer in kind (no-op if we already did)
              Effect.andThen(greet(key)),
            )
          : frame.kind === "msg"
            ? PubSub.publish(inbound, frame.msg).pipe(Effect.asVoid)
            : frame.kind === "room-meta"
              ? absorbMeta({ name: frame.name, ts: frame.ts })
              : frame.kind === "drive"
                ? PubSub.publish(driveRequests, { from: key, action: frame.action }).pipe(Effect.asVoid)
                : absorbTicket(frame.ticket),
    };

    topicHex = yield* swarm.join(roomTopic(config.roomName), hooks);

    const sendTo = Effect.fn("Room.sendTo")(function* (
      peerKey: string,
      payload: { project: string; intent: string; findings: string },
    ) {
      // in the room, not merely connected through another one
      if (!peers.has(peerKey)) return yield* new PeerNotConnected({ peerKey });
      const ts = yield* Clock.currentTimeMillis;
      const msg: RoomMessage = {
        id: yield* Effect.sync(() => randomUUID()),
        threadId: deriveThreadId(me, peerKey, payload.project),
        from: me,
        // live profile name, not the startup snapshot — renames apply mid-run
        fromName: (yield* config.getProfile).name,
        project: payload.project,
        intent: payload.intent,
        findings: payload.findings,
        ts,
      };
      yield* send(peerKey, { kind: "msg", msg });
      yield* SubscriptionRef.update(sent, (s) => [...s.slice(-99), msg]);
      return msg;
    });

    /** Ask a peer to act as itself (testing; only mock peers obey). */
    const sendDrive = Effect.fn("Room.sendDrive")(function* (peerKey: string, action: DriveAction) {
      if (!peers.has(peerKey)) return yield* new PeerNotConnected({ peerKey });
      yield* send(peerKey, { kind: "drive", action });
    });

    /** Rename the room for everyone: stamp now, set locally, broadcast. */
    const rename = Effect.fn("Room.rename")(function* (name: string) {
      const ts = yield* Clock.currentTimeMillis;
      yield* SubscriptionRef.set(meta, { name, ts });
      yield* Effect.log(`rename → "${name}", broadcasting to ${peers.size} peer(s)`);
      yield* broadcast({ kind: "room-meta", name, ts });
    });

    /** Merge a ticket locally and broadcast the merged copy to the room. */
    const shareTicket = Effect.fn("Room.shareTicket")(function* (ticket: Ticket) {
      yield* absorbTicket(ticket);
      const merged = (yield* SubscriptionRef.get(tickets)).get(ticket.id) ?? ticket;
      yield* broadcast({ kind: "ticket", ticket: merged });
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
      /** Send a directed message; fails typed if the peer isn't in the room. */
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
