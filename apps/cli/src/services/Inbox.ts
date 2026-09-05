import { Context, Effect, Layer, Ref, SubscriptionRef } from "effect";
import type { RoomMessage } from "@collagen/p2p";

/** Buffer of incoming messages awaiting pickup by the recipient's AI via the
 *  `get-messages` MCP tool, plus a small recent-messages ring for the UI. */
export class Inbox extends Context.Service<Inbox>()("cli/Inbox", {
  make: Effect.gen(function* () {
    const buffer = yield* Ref.make<ReadonlyArray<RoomMessage>>([]);
    const recent = yield* SubscriptionRef.make<ReadonlyArray<RoomMessage>>([]);

    const push = (msg: RoomMessage) =>
      Ref.update(buffer, (b) => [...b, msg]).pipe(
        Effect.andThen(SubscriptionRef.update(recent, (r) => [...r.slice(-99), msg])),
      );

    /** Drain the buffer — everything, or just one thread's messages. */
    const take = (threadId?: string) =>
      Ref.modify(buffer, (b) =>
        threadId === undefined
          ? ([b, []] as const)
          : ([b.filter((m) => m.threadId === threadId), b.filter((m) => m.threadId !== threadId)] as const),
      );

    /** Non-destructive read of one thread's queued messages. */
    const peekThread = (threadId: string) =>
      Ref.get(buffer).pipe(Effect.map((b) => b.filter((m) => m.threadId === threadId)));

    /** One row per waiting thread (newest-first), without draining — so a
     *  puller can see what's queued and choose a thread to pull by id. */
    const pending = Ref.get(buffer).pipe(
      Effect.map((b) => {
        const byThread = new Map<
          string,
          { threadId: string; from: string; project: string; count: number; lastIntent: string; lastTs: number }
        >();
        for (const m of b) {
          const cur = byThread.get(m.threadId);
          byThread.set(m.threadId, {
            threadId: m.threadId,
            from: m.fromName,
            project: m.project,
            count: (cur?.count ?? 0) + 1,
            lastIntent: m.intent,
            lastTs: m.ts,
          });
        }
        return [...byThread.values()].sort((a, b) => b.lastTs - a.lastTs);
      }),
    );

    return { push, take, peekThread, pending, recent } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
