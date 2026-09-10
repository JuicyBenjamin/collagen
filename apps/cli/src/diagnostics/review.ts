import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { reviewRows } from "../lib/review";
import { diagnostic } from "./registry";

/** The why behind a review ticket's change: what was decided, how the author's
 *  person steered it, what their agent reasoned, and every fork in the road.
 *  Read on demand — this is the tool the reviewer's agent reaches for when
 *  their person says "I don't understand why this was done". */
export const reviewContext = diagnostic<{ readonly ticketId: string; readonly about?: string }>({
  id: "review-context",
  title: "why",
  summary:
    "Why the code under review is the way it is — the half a diff cannot show. Returns the author's summary, the branch and link, every decision (what was decided, how their user steered it, what their agent reasoned, and the file:line it produced) and every fork in the road (what was chosen over what, and why). Call it when your user questions a piece of the change (\"why is this here\", \"I don't like this part\") instead of guessing at intent, and relay what is there — never fill gaps from your own head. 'about' narrows it to one part: a file path, a symbol, or the phrase your user just used. 'updated' is when the author last revised it — the code and the why move while a review runs, so read it again rather than trusting what you read before. Nothing leaves this machine: the record is already on the room's log.",
  params: Schema.Struct({ ticketId: Schema.String, about: Schema.optional(Schema.String) }),
  // a review ticket shows a review section of its own, and enter there opens
  // the page — nothing to add to the diagnostics row
  fromContext: () => null,
  run: ({ ticketId, about }, ctx, { rooms }) =>
    Effect.gen(function* () {
      const h = (yield* SubscriptionRef.get(rooms.handles)).find((x) => x.id === ctx.roomId);
      if (!h) return "failed: that room is gone";
      const review = (yield* SubscriptionRef.get(h.room.reviews)).find((r) => r.ticketId === ticketId);
      if (!review) {
        const ticket = (yield* SubscriptionRef.get(h.room.tickets)).get(ticketId);
        return ticket
          ? `no why on this ticket — "${ticket.goal}" is not a review ticket (its author would have asked with ask-review)`
          : `failed: no ticket ${ticketId} — check get-tickets`;
      }
      const rows = reviewRows(review, about);
      if (about && rows.decisions.length === 0 && rows.forks.length === 0) {
        return `nothing in the why mentions "${about}" — call review-context without 'about' for all ${review.decisions.length} decision(s) and ${review.forks.length} fork(s), or ask ${review.authorName} through their person (send-to-peer, with this ticketId)`;
      }
      return toToon(rows);
    }),
});
