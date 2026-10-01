import { Context, Effect, Layer, SubscriptionRef } from "effect";
import type { RoomMessage } from "@collagen/p2p";
import { StateStore } from "./StateStore";

/** A message waiting for pickup, tagged with the room it belongs to. Thread
 *  ids are derived per peer-pair + project, so the room is what keeps two
 *  rooms' conversations about the same project apart. `seq` is the message's
 *  position on the room's log; step deliveries are local and have none. */
export interface Received {
  readonly roomId: string;
  readonly msg: RoomMessage;
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
export const wantsPerson = (msg: RoomMessage): boolean => !msg.intent.startsWith("ticket-update:");

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
      store.get.pipe(Effect.map((s) => s.consumed?.[roomId]?.[threadId] ?? -1));

    /** Offer a message; already-pulled (by cursor) or already-buffered ones are dropped. */
    const push = (roomId: string, msg: RoomMessage, seq?: number) =>
      Effect.gen(function* () {
        if (seq !== undefined && seq <= (yield* cursor(roomId, msg.threadId))) return;
        yield* SubscriptionRef.update(buffer, (b) =>
          b.some((e) => e.msg.id === msg.id) ? b : [...b, { roomId, msg, seq }],
        );
      });

    /** Drain one room's waiting messages — everything, or just one thread's —
     *  and remember how far each thread was read. */
    const take = (roomId: string, threadId?: string) =>
      Effect.gen(function* () {
        const mine = (e: Received) => e.roomId === roomId && (threadId === undefined || e.msg.threadId === threadId);
        const taken = yield* SubscriptionRef.modify(buffer, (b) => [b.filter(mine), b.filter((e) => !mine(e))] as const);
        const advanced = new Map<string, number>();
        for (const e of taken) {
          if (e.seq === undefined) continue;
          advanced.set(e.msg.threadId, Math.max(advanced.get(e.msg.threadId) ?? -1, e.seq));
        }
        if (advanced.size > 0) {
          yield* store.update((s) => ({
            ...s,
            consumed: {
              ...(s.consumed ?? {}),
              [roomId]: { ...(s.consumed?.[roomId] ?? {}), ...Object.fromEntries(advanced) },
            },
          }));
        }
        return taken.map((e) => e.msg);
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

    /** Waiting messages per room: everything an agent has yet to pull
     *  (`unread`), and the part of it that asks the person to act
     *  (`needsYou`, the rail's dot). */
    const unread = SubscriptionRef.get(buffer).pipe(
      Effect.map((b) => {
        const counts = new Map<string, { unread: number; needsYou: number }>();
        for (const e of b) {
          const c = counts.get(e.roomId) ?? { unread: 0, needsYou: 0 };
          counts.set(e.roomId, { unread: c.unread + 1, needsYou: c.needsYou + (wantsPerson(e.msg) ? 1 : 0) });
        }
        return counts as ReadonlyMap<string, { readonly unread: number; readonly needsYou: number }>;
      }),
    );

    return { buffer, push, take, peekThread, pending, unread } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
