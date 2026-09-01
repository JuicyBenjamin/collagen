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
        Effect.andThen(SubscriptionRef.update(recent, (r) => [...r.slice(-19), msg])),
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

    return { push, take, peekThread, recent } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
