import { Context, Effect, Layer, SubscriptionRef } from "effect";
import type { RoomMessage } from "@collagen/p2p";
import { StateStore } from "./StateStore";

/** A message waiting for pickup, tagged with the room it belongs to. Thread
 *  ids are derived per peer-pair + project, so the room is what keeps two
 *  rooms' conversations about the same project apart. `seq` is the message's
 *  position on the room's log; step deliveries are local and have none. */
export interface Received {
  readonly roomId: string;
  readonly message: RoomMessage;
  readonly seq?: number;
}

export interface PendingThread {
  threadId: string;
  from: string;
  project: string;
  count: number;
  lastIntent: string;
  lastTs: number;
}

/** Does this waiting message ask something of the PERSON? A peer's message
 *  to them, or a step that became theirs: yes. A ticket-update nudge —
 *  someone else settled, took, weighed in, revised — is context for their
 *  agent (it resumes an adopted thread with it) and asks nothing of them.
 *  The rail's dot counts only the first kind: a mark means you must act. */
export const wantsPerson = (message: RoomMessage): boolean => !message.intent.startsWith("ticket-update:");

/** What is waiting for this reader. Messages themselves live on each room's
 *  log; "waiting" is local: a message is pending until it is pulled with
 *  get-messages, and the pull is remembered as a per-thread cursor (log
 *  position) in local state — so a restart re-reads the log and lands on the
 *  same unread set. A room's unread count is how many messages wait here. */
export class Inbox extends Context.Service<Inbox>()("cli/Inbox", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const buffer = yield* SubscriptionRef.make<ReadonlyArray<Received>>([]);

    const cursor = (roomId: string, threadId: string) =>
      store.get.pipe(Effect.map((state) => state.consumed?.[roomId]?.[threadId] ?? -1));

    /** Offer a message; already-pulled (by cursor) or already-buffered ones are dropped. */
    const push = (roomId: string, message: RoomMessage, seq?: number) =>
      Effect.gen(function* () {
        if (seq !== undefined && seq <= (yield* cursor(roomId, message.threadId))) return;
        yield* SubscriptionRef.update(buffer, (waiting) =>
          waiting.some((received) => received.message.id === message.id) ? waiting : [...waiting, { roomId, message, seq }],
        );
      });

    /** Drain one room's waiting messages — everything, or just one thread's —
     *  and remember how far each thread was read. */
    const take = (roomId: string, threadId?: string) =>
      Effect.gen(function* () {
        const mine = (received: Received) => received.roomId === roomId && (threadId === undefined || received.message.threadId === threadId);
        const taken = yield* SubscriptionRef.modify(buffer, (waiting) => [waiting.filter(mine), waiting.filter((received) => !mine(received))] as const);
        const advanced = new Map<string, number>();
        for (const received of taken) {
          if (received.seq === undefined) continue;
          advanced.set(received.message.threadId, Math.max(advanced.get(received.message.threadId) ?? -1, received.seq));
        }
        if (advanced.size > 0) {
          yield* store.update((state) => ({
            ...state,
            consumed: {
              ...(state.consumed ?? {}),
              [roomId]: { ...(state.consumed?.[roomId] ?? {}), ...Object.fromEntries(advanced) },
            },
          }));
        }
        return taken.map((received) => received.message);
      });

    /** Non-destructive read of one thread's queued messages. */
    const peekThread = (threadId: string) =>
      SubscriptionRef.get(buffer).pipe(Effect.map((waiting) => waiting.filter((received) => received.message.threadId === threadId)));

    /** One row per waiting thread in a room (newest-first), without draining. */
    const pending = (roomId: string) =>
      SubscriptionRef.get(buffer).pipe(
        Effect.map((waiting) => {
          const byThread = new Map<string, PendingThread>();
          for (const { message } of waiting.filter((received) => received.roomId === roomId)) {
            const existing = byThread.get(message.threadId);
            byThread.set(message.threadId, {
              threadId: message.threadId,
              from: message.fromName,
              project: message.project,
              count: (existing?.count ?? 0) + 1,
              lastIntent: message.intent,
              lastTs: message.ts,
            });
          }
          return [...byThread.values()].sort((a, b) => b.lastTs - a.lastTs);
        }),
      );

    /** Waiting messages per room: everything an agent has yet to pull
     *  (`unread`), and the part of it that asks the person to act
     *  (`needsYou`, the rail's dot). */
    const unread = SubscriptionRef.get(buffer).pipe(
      Effect.map((waiting) => {
        const counts = new Map<string, { unread: number; needsYou: number }>();
        for (const received of waiting) {
          const tally = counts.get(received.roomId) ?? { unread: 0, needsYou: 0 };
          counts.set(received.roomId, { unread: tally.unread + 1, needsYou: tally.needsYou + (wantsPerson(received.message) ? 1 : 0) });
        }
        return counts as ReadonlyMap<string, { readonly unread: number; readonly needsYou: number }>;
      }),
    );

    return { buffer, push, take, peekThread, pending, unread } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
