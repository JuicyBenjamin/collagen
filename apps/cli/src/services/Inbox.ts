import { Context, Effect, Layer, SubscriptionRef } from "effect";
import type { RoomMessage } from "@collagen/p2p";

/** A message we received, tagged with the room it arrived in. Thread ids are
 *  derived per peer-pair + project, so the room is what keeps two rooms'
 *  conversations about the same project apart. */
export interface Received {
  readonly roomId: string;
  readonly msg: RoomMessage;
}

export interface PendingThread {
  threadId: string;
  from: string;
  project: string;
  count: number;
  lastIntent: string;
  lastTs: number;
}

/** Buffer of received messages awaiting pickup (the `get-messages` MCP tool)
 *  plus a recent-messages ring for the UI. A room's unread count is simply
 *  how many of its messages are still waiting here. */
export class Inbox extends Context.Service<Inbox>()("cli/Inbox", {
  make: Effect.gen(function* () {
    const buffer = yield* SubscriptionRef.make<ReadonlyArray<Received>>([]);
    const recent = yield* SubscriptionRef.make<ReadonlyArray<Received>>([]);

    const push = (roomId: string, msg: RoomMessage) =>
      SubscriptionRef.update(buffer, (b) => [...b, { roomId, msg }]).pipe(
        Effect.andThen(SubscriptionRef.update(recent, (r) => [...r.slice(-99), { roomId, msg }])),
      );

    /** Drain one room's waiting messages — everything, or just one thread's. */
    const take = (roomId: string, threadId?: string) =>
      SubscriptionRef.modify(buffer, (b) => {
        const mine = (e: Received) => e.roomId === roomId && (threadId === undefined || e.msg.threadId === threadId);
        return [b.filter(mine).map((e) => e.msg), b.filter((e) => !mine(e))] as const;
      });

    /** Non-destructive read of one thread's queued messages. */
    const peekThread = (threadId: string) =>
      SubscriptionRef.get(buffer).pipe(Effect.map((b) => b.filter((e) => e.msg.threadId === threadId)));

    /** One row per waiting thread in a room (newest-first), without draining. */
    const pending = (roomId: string) =>
      SubscriptionRef.get(buffer).pipe(
        Effect.map((b) => {
          const byThread = new Map<string, PendingThread>();
          for (const { msg } of b.filter((e) => e.roomId === roomId)) {
            const cur = byThread.get(msg.threadId);
            byThread.set(msg.threadId, {
              threadId: msg.threadId,
              from: msg.fromName,
              project: msg.project,
              count: (cur?.count ?? 0) + 1,
              lastIntent: msg.intent,
              lastTs: msg.ts,
            });
          }
          return [...byThread.values()].sort((a, b) => b.lastTs - a.lastTs);
        }),
      );

    /** Waiting messages per room — the sidebar's unread badges. */
    const unread = SubscriptionRef.get(buffer).pipe(
      Effect.map((b) => {
        const counts = new Map<string, number>();
        for (const e of b) counts.set(e.roomId, (counts.get(e.roomId) ?? 0) + 1);
        return counts as ReadonlyMap<string, number>;
      }),
    );

    return { buffer, push, take, peekThread, pending, unread, recent } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
