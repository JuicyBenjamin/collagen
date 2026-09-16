import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { isJudged, isTake } from "@collagen/p2p";
import { reviewRows } from "../lib/review";
import { diagnostic } from "./registry";

/** The why behind a review ticket's change: what was decided, how the author's
 *  person steered it, what their agent reasoned, and every fork in the road.
 *  Read on demand — this is the tool the reviewer's agent reaches for when
 *  their person says "I don't understand why this was done". */
export const reviewContext = diagnostic<{ readonly ticketId: string; readonly about?: string; readonly anyway?: boolean }>({
  id: "review-context",
  title: "why",
  summary:
    "Why the code under review is the way it is — the half a diff cannot show — or, on a plan or a proposal, the author's thoughts behind what they intend. Returns the author's summary, the branch and link, every decision (what was decided, how their user steered it, what their agent reasoned, and the file:line it produced) and every fork in the road (what was chosen over what, and why). Call it when your user questions a piece of the change (\"why is this here\", \"I don't like this part\") instead of guessing at intent, and relay what is there — never fill gaps from your own head. 'about' narrows it to one part: a file path, a symbol, or the phrase your user just used. 'updated' is when the author last revised it — the code and the why move while a review runs, so read it again rather than trusting what you read before. ON A PLAN OR A PROPOSAL your user gives a BLIND FIRST TAKE: until they have posted one (post-review), this answers with the goal alone — their view before the author's has coloured it is the point. If they ask to see everything first, pass anyway: true, and tell them you did. Nothing leaves this machine: the record is already on the room's log.",
  params: Schema.Struct({ ticketId: Schema.String, about: Schema.optional(Schema.String), anyway: Schema.optional(Schema.Boolean) }),
  // a review ticket shows a review section of its own, and enter there opens
  // the page — nothing to add to the diagnostics row
  fromContext: () => null,
  run: ({ ticketId, about, anyway }, ctx, { rooms, me }) =>
    Effect.gen(function* () {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === ctx.roomId);
      if (!h) return "failed: that room is gone";
      const review = (yield* SubscriptionRef.get(h.room.reviews)).find((r) => r.ticketId === ticketId);
      const ticket = (yield* SubscriptionRef.get(h.room.tickets)).get(ticketId);
      if (!review) {
        return ticket
          ? `no why on this ticket — "${ticket.goal}" is a ${ticket.kind}, not a review, plan or proposal (its author would have filed it with ask-review, ask-plan or propose)`
          : `failed: no ticket ${ticketId} — check get-tickets`;
      }
      // the blind first take: on a plan or a proposal, a reader's agent gets
      // the goal alone until that reader has posted their own take. The log
      // is shared, so this hides nothing from anyone — it is a courtesy the
      // reader's agent keeps, and says when the person asked it not to
      if (ticket && isJudged(ticket.kind) && ticket.kind !== "review" && ticket.createdBy !== me && !anyway) {
        const taken = ticket.steps.some((s) => isTake(s) && s.owner === me && (s.status === "settled" || s.status === "failed"));
        if (!taken) {
          return `${ticket.kind}: "${ticket.goal}"\n\nThis is the blind first take. ${review.authorName}'s thoughts (${review.decisions.length} decision(s), ${review.forks.length} fork(s)) are on this ticket, but your user has not taken a position yet. Ask them what THEY think of "${ticket.goal}" and post it with post-review (failed: true asks for changes) — then call review-context again and the thoughts open. If they would rather read everything first, call review-context with anyway: true and tell them you skipped the blind take.`;
        }
      }
      const rows = reviewRows(review, about);
      if (about && rows.decisions.length === 0 && rows.forks.length === 0 && (rows.outline?.length ?? 0) === 0) {
        return `nothing in the why mentions "${about}" — call review-context without 'about' for all ${review.decisions.length} decision(s) and ${review.forks.length} fork(s), or ask ${review.authorName} through their person (send-to-peer, with this ticketId)`;
      }
      return toToon(rows);
    }),
});
