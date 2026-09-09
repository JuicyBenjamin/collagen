import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { diagnostic } from "./registry";

/** Ask everyone present for their agents' conversations on a ticket (or one thread). */
export const requestTranscripts = diagnostic<{ readonly ticketId?: string; readonly threadId?: string }>({
  id: "request-transcripts",
  title: "Ask peers for their agents' conversations",
  summary:
    "Collect how the agents behaved around a ticket (or one thread). Everyone present in the room is asked for their agent's conversation on the threads involved; on each machine that lands in the person's outbox and leaves only if they approve, and only from the moment they adopted the thread. Answers are filed under ~/.config/collagen/transcripts/<subject>/ — see list-transcripts. The user's own adopted conversations on those threads are filed at once. Pass ticketId (from get-tickets) or threadId (from pending-threads).",
  params: Schema.Struct({ ticketId: Schema.optional(Schema.String), threadId: Schema.optional(Schema.String) }),
  fromContext: (ctx) => (ctx.ticketId ? { ticketId: ctx.ticketId } : null),
  run: ({ ticketId, threadId }, ctx, { rooms, transcripts }) =>
    Effect.gen(function* () {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === ctx.roomId);
      if (!h) return "failed: that room is gone";
      let subject: string;
      let threadIds: ReadonlyArray<string>;
      if (ticketId) {
        const ticket = (yield* SubscriptionRef.get(h.room.tickets)).get(ticketId);
        if (!ticket) return `failed: no ticket ${ticketId} — check get-tickets`;
        subject = `ticket-${ticketId.slice(0, 8)}`;
        threadIds = transcripts.threadsOfTicket(ticket);
      } else if (threadId) {
        subject = `thread-${threadId}`;
        threadIds = [threadId];
      } else {
        return "failed: pass ticketId or threadId";
      }
      const r = yield* transcripts.request(ctx.roomId, subject, threadIds);
      return `asked ${r.asked} peer(s) present for their conversations on ${threadIds.length} thread(s); ${r.own} of your own filed. Each peer decides in their outbox; what arrives lands in ${r.dir}.`;
    }),
});

/** What has arrived so far. */
export const listTranscripts = diagnostic<Record<string, never>>({
  id: "list-transcripts",
  title: "Conversations collected so far",
  summary: "The agent conversations collected with request-transcripts: subject, file path, size. Read a file to see how an agent behaved.",
  fromContext: () => ({}),
  run: (_params, _ctx, { transcripts }) =>
    transcripts.list.pipe(
      Effect.map((files) =>
        files.length === 0
          ? `none yet (they land in ${transcripts.dir})`
          : toToon({ transcripts: files.map((f) => ({ subject: f.subject, file: f.file, kb: Math.max(1, Math.round(f.bytes / 1024)) })) }),
      ),
    ),
});
