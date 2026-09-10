import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { to } from "../app/router";
import { diagnostic } from "./registry";

/** Ask everyone present for their agents' conversations on a ticket (or one thread). */
export const requestTranscripts = diagnostic<{ readonly ticketId?: string; readonly threadId?: string }>({
  id: "request-transcripts",
  title: "collect transcripts",
  summary:
    "Collect how the agents behaved around a ticket (or one thread). Everyone present in the room is asked for their agent's conversation on the threads involved; on each machine the ask waits for that person's word (share-transcripts) and covers only what happened after they adopted the thread — nothing arrives by itself. Answers are filed under ~/.config/collagen/transcripts/<subject>/ — see list-transcripts. The user's own adopted conversations on those threads are filed at once. Pass ticketId (from get-tickets) or threadId (from pending-threads).",
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
      return `asked ${r.asked} peer(s) present for their conversations on ${threadIds.length} thread(s); ${r.own} of your own filed. Each of them decides; what they hand over lands in ${r.dir}.`;
    }),
});

/** The other end of a request: your session, so your call. */
export const shareTranscripts = diagnostic<{
  readonly subject?: string;
  readonly requester?: string;
  readonly threadId?: string;
  readonly decline?: boolean;
}>({
  id: "share-transcripts",
  title: "hand over transcripts",
  summary:
    "Hand over the agent conversations a peer has asked for. A transcript is your user's own session, so it is the one thing that never leaves on its own: the ask waits until the user says to share it — then this sends it, from the moment they adopted the thread onwards. With no arguments it answers every waiting ask; narrow it with requester, subject or threadId. Pass decline: true instead to drop the asks and send nothing (the peer is not told). Call it only when the user has said so, and read them the asks first (they are in the log line and in this tool's answer when nothing is waiting).",
  params: Schema.Struct({
    subject: Schema.optional(Schema.String),
    requester: Schema.optional(Schema.String),
    threadId: Schema.optional(Schema.String),
    decline: Schema.optional(Schema.Boolean),
  }),
  // not a row on the ticket page: handing over a session is something the
  // person says in words to their own agent, not a key they can hit by
  // accident on a page about someone else's ticket
  fromContext: () => null,
  run: ({ decline, ...filter }, _ctx, { transcripts }) => (decline ? transcripts.decline(filter) : transcripts.share(filter)),
});

/** What has arrived so far, and what is waiting on the user's word. */
export const listTranscripts = diagnostic<Record<string, never>>({
  id: "list-transcripts",
  title: "transcripts",
  summary:
    "The agent conversations collected with request-transcripts: subject, file path, size. Read a file to see how an agent behaved. Also lists the requests peers have made of this machine and that nothing has answered — read those to the user; share-transcripts hands one over when they say so.",
  fromContext: () => ({}),
  open: (ctx, back) => to.transcripts(ctx.ticketId ? `ticket-${ctx.ticketId.slice(0, 8)}` : "", back),
  run: (_params, _ctx, { transcripts }) =>
    Effect.gen(function* () {
      const files = yield* transcripts.list;
      const waiting = yield* transcripts.asks;
      const have =
        files.length === 0
          ? `none yet (they land in ${transcripts.dir})`
          : toToon({
              transcripts: files.map((f) => ({
                subject: f.subject,
                from: f.meta?.from ?? "?",
                ai: f.meta?.ai ?? "?",
                entries: f.meta?.entries ?? 0,
                since: f.meta ? new Date(f.meta.since).toISOString() : "",
                receivedAt: f.meta ? new Date(f.meta.receivedAt).toISOString() : "",
                file: f.file,
                kb: Math.max(1, Math.round(f.bytes / 1024)),
              })),
            });
      if (waiting.length === 0) return have;
      const asks = toToon({
        askedOfYou: waiting.map((a) => ({
          requester: a.requesterName,
          subject: a.subject,
          threadId: a.threadId,
          ai: a.ai,
          since: new Date(a.since).toISOString(),
          askedAt: new Date(a.ts).toISOString(),
        })),
      });
      return `${have}\n\n${asks}\n\nNothing above has left this machine. Tell your user who asked and for what; share-transcripts sends it if they say so.`;
    }),
});
