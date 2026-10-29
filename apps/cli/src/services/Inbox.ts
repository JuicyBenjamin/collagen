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

/** One row per thread the messages are on, newest-first. */
const rows = (messages: ReadonlyArray<RoomMessage>): ReadonlyArray<PendingThread> => {
  const byThread = new Map<string, PendingThread>();
  for (const message of [...messages].sort((first, second) => first.ts - second.ts)) {
    const existing = byThread.get(message.threadId);
    byThread.set(message.threadId, { threadId: message.threadId, from: message.fromName, project: message.project, count: (existing?.count ?? 0) + 1, lastIntent: message.intent, lastTs: message.ts });
  }
  return [...byThread.values()].sort((first, second) => second.lastTs - first.lastTs);
};

/** What one AI conversation got from a thread: what is new to it, and —
 *  the first time it reads the thread — the last few messages it came in
 *  after, for a catch-up. */
export interface Read {
  readonly messages: ReadonlyArray<RoomMessage>;
  readonly first: boolean;
  readonly before: ReadonlyArray<RoomMessage>;
}

/** How many of a thread's messages are kept here to read back from. */
const HISTORY = 100;
/** How many conversations' places are kept. */
const READERS = 50;
/** How many earlier messages a conversation new to a thread is shown. */
const CATCH_UP = 3;

/** What is waiting for this reader. Messages themselves live on each room's
 *  log; "waiting" is local: a message is pending until it is pulled with
 *  get-messages, and the pull is remembered as a per-thread cursor (log
 *  position) in local state — so a restart re-reads the log and lands on the
 *  same unread set. A room's unread count is how many messages wait here.
 *
 *  Each AI conversation also keeps its own place in each thread (`reads`, by
 *  conversation): what one conversation read is not read for another, and a
 *  conversation new to a thread starts at its tail, with the last few
 *  messages for a catch-up — never the thread's whole history as news. A
 *  reader no harness names shares the one place, as before. */
export class Inbox extends Context.Service<Inbox>()("cli/Inbox", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const buffer = yield* SubscriptionRef.make<ReadonlyArray<Received>>([]);
    // each thread's latest messages, read or not, by room and thread: what a
    // conversation reads back from (rebuilt from the log on a restart)
    const history = yield* SubscriptionRef.make<ReadonlyMap<string, ReadonlyArray<RoomMessage>>>(new Map());
    const at = (roomId: string, threadId: string) => `${roomId} ${threadId}`;

    const cursor = (roomId: string, threadId: string) =>
      store.get.pipe(Effect.map((state) => state.consumed?.[roomId]?.[threadId] ?? -1));

    /** Offer a message; already-pulled (by cursor) or already-buffered ones are dropped. */
    const push = (roomId: string, message: RoomMessage, seq?: number) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(history, (kept) => {
          const thread = kept.get(at(roomId, message.threadId)) ?? [];
          if (thread.some((had) => had.id === message.id)) return kept;
          return new Map(kept).set(at(roomId, message.threadId), [...thread, message].sort((first, second) => first.ts - second.ts).slice(-HISTORY));
        });
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

    /** One conversation reads a thread: what is new to it — after its own
     *  place, and anything nobody has read yet — with the last few messages
     *  before, the first time. Its place moves to the thread's tail, and what
     *  waited for anyone is read (as take). */
    const read = (roomId: string, threadId: string, reader: string) =>
      Effect.gen(function* () {
        const place = (yield* store.get).reads?.[reader]?.[roomId]?.[threadId];
        const thread = (yield* SubscriptionRef.get(history)).get(at(roomId, threadId)) ?? [];
        const unreadByAnyone = yield* take(roomId, threadId);
        const after = place === undefined ? [] : thread.filter((message) => message.ts > place);
        const messages = [...new Map([...after, ...unreadByAnyone].map((message) => [message.id, message])).values()].sort((first, second) => first.ts - second.ts);
        const shown = new Set(messages.map((message) => message.id));
        const before = place === undefined ? thread.filter((message) => !shown.has(message.id)).slice(-CATCH_UP) : [];
        const tail = Math.max(place ?? -1, ...thread.map((message) => message.ts), ...messages.map((message) => message.ts));
        yield* store.update((state) => {
          const { [reader]: had, ...others } = state.reads ?? {};
          const kept = Object.entries(others).slice(-(READERS - 1));
          return { ...state, reads: { ...Object.fromEntries(kept), [reader]: { ...had, [roomId]: { ...had?.[roomId], [threadId]: tail } } } };
        });
        return { messages, first: place === undefined, before } satisfies Read;
      });

    /** One conversation's waiting threads in a room: what nobody has read,
     *  and what is new since its own place in the threads it has read. */
    const pendingFor = (roomId: string, reader: string) =>
      Effect.gen(function* () {
        const places = (yield* store.get).reads?.[reader]?.[roomId] ?? {};
        const kept = yield* SubscriptionRef.get(history);
        const waiting = (yield* SubscriptionRef.get(buffer)).filter((received) => received.roomId === roomId).map((received) => received.message);
        const newer = Object.entries(places).flatMap(([threadId, place]) => (kept.get(at(roomId, threadId)) ?? []).filter((message) => message.ts > place));
        return rows([...new Map([...waiting, ...newer].map((message) => [message.id, message])).values()]);
      });

    /** Non-destructive read of one thread's queued messages. */
    const peekThread = (threadId: string) =>
      SubscriptionRef.get(buffer).pipe(Effect.map((waiting) => waiting.filter((received) => received.message.threadId === threadId)));

    /** One row per waiting thread in a room (newest-first), without draining. */
    const pending = (roomId: string) =>
      SubscriptionRef.get(buffer).pipe(Effect.map((waiting) => rows(waiting.filter((received) => received.roomId === roomId).map((received) => received.message))));

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

    return { buffer, push, take, read, peekThread, pending, pendingFor, unread } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
