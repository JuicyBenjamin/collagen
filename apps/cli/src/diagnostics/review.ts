import { Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { readStrength, withStrength } from "@collagen/review-web/strength";
import { closedAs, epicBecause, epicParts, epicStatus, excludedFromEpic, finished, isClosed, isJudged, visibleTo } from "@collagen/p2p";
import { whereOf } from "../lib/comments";
import { whyOpen } from "../lib/mergeTickets";
import { reviewRows } from "../lib/review";
import { roomEdges, stackOf, stackPlace } from "../lib/stack";
import { diagnostic } from "./registry";

/** The why behind a review ticket's change: what was decided, how the author's
 *  person steered it, what their agent reasoned, and every fork in the road.
 *  Read on demand — this is the tool the reviewer's agent reaches for when
 *  their person says "I don't understand why this was done". */
export const reviewContext = diagnostic<{ readonly ticketId: string; readonly about?: string; readonly anyway?: boolean }>({
  id: "review-context",
  title: "why",
  summary:
    "Why the code under review is the way it is — the half a diff cannot show — or, on a plan or a proposal, the author's thoughts behind what they intend; on a bug, the reporter's reading of the symptom; on an investigation, what is known, ruled out and, once over, found. Returns the author's summary, the branch and link, every decision (what was decided, how their user steered it, what their agent reasoned, and the file:line it produced) and every fork in the road (what was chosen over what, and why). Call it when your user questions a piece of the change (\"why is this here\", \"I don't like this part\") instead of guessing at intent, and relay what is there — never fill gaps from your own head. 'about' narrows it to one part: a file path, a symbol, or the phrase your user just used. 'updated' is when the author last revised it — the code and the why move while a review runs, so read it again rather than trusting what you read before. ON A PLAN, A PROPOSAL, A BUG OR AN INVESTIGATION your user gives a BLIND FIRST TAKE: until they have posted one (post-review), this answers with the goal alone — on a bug, the symptom alone; on an investigation, the question alone — their view before the author's has coloured it is the point. If they ask to see everything first, pass anyway: true, and tell them you did. Nothing leaves this machine: the record is already on the room's log.",
  params: Schema.Struct({ ticketId: Schema.String, about: Schema.optional(Schema.String), anyway: Schema.optional(Schema.Boolean) }),
  // a review ticket shows a review section of its own, and enter there opens
  // the page — nothing to add to the diagnostics row
  fromContext: () => null,
  run: ({ ticketId, about, anyway }, context, { rooms, me, reviewStarted }) =>
    Effect.gen(function* () {
      const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === context.roomId);
      if (!handle) return "failed: that room is gone";
      const review = (yield* SubscriptionRef.get(handle.room.reviews)).find((existing) => existing.ticketId === ticketId);
      const all = yield* SubscriptionRef.get(handle.room.tickets);
      const ticket = all.get(ticketId);
      // a ticket still waiting on another (after) is its author's alone: its
      // readers take it in order, so to them it is not there yet
      if (ticket && !visibleTo(ticket, all, me)) return `failed: no ticket ${ticketId} — check get-tickets`;
      // an epic: its aim, and what is in it — no why to weigh, no take to give
      if (ticket?.kind === "epic") {
        const { parts, counted, done, unresolved } = epicParts(ticket, all);
        const status = epicStatus(ticket, all);
        const closed = status.closed;
        return toToon({
          epic: {
            goal: ticket.goal,
            aim: review?.summary ?? "",
            progress: counted === 0 ? "nothing counted yet" : `${done} of ${counted} pieces of work done`,
            ...(epicBecause(status, all, me) ? { [closed ? "closedBecause" : "openBecause"]: epicBecause(status, all, me)! } : {}),
            ...(closed ? {} : { toClose: unresolved.length === 0 ? "everything in it is resolved: it can close" : `${unresolved.length} still to resolve, exclude or move out first` }),
          },
          tickets: parts
            .filter((part) => visibleTo(part, all, me))
            .map((part) => ({
              id: part.id,
              kind: part.kind,
              project: part.project,
              goal: part.goal,
              state: excludedFromEpic(part) ? "excluded" : closedAs(part) === "dropped" ? "dropped" : closedAs(part) === "done" ? "closed as done" : finished(part) ? "done" : isClosed(part) ? "closed" : "open",
            })),
        });
      }
      if (!review) {
        return ticket
          ? isJudged(ticket.kind)
            ? `no why on this ticket here yet — "${ticket.goal}" is a ${ticket.kind}, but the why its author filed has not reached this machine; try again once they are online`
            : `no why on this ticket — "${ticket.goal}" is a ${ticket.kind}, not a review, plan or proposal (its author would have filed it with ask-review, ask-plan or propose)`
          : `failed: no ticket ${ticketId} — check get-tickets`;
      }
      // the blind first take: on a plan or a proposal, a reader's agent gets
      // the goal alone until that reader has posted their own take. The log
      // is shared, so this hides nothing from anyone — it is a courtesy the
      // reader's agent keeps, and says when the person asked it not to
      if (ticket && !anyway && !whyOpen(ticket, me)) {
        // on a bug the fact is shown and the reading is not: the symptom, then
        // your person's own diagnosis, then the reporter's cause and suggestion
        if (ticket.kind === "bug" && review.bug) {
          return `bug: "${ticket.goal}"\nsymptom: ${review.bug.symptom}\n\nThis is the blind first take. ${review.authorName}'s reading of it (cause, importance, suggestion, remedy) is on this ticket, but your user has not given theirs yet. Ask them what THEY make of the symptom — what is happening, how bad, what would fix it — and post it with post-review (failed: true asks the reporter for changes) — then call review-context again and the reporter's reading opens. If they would rather read everything first, call review-context with anyway: true and tell them you skipped the blind take.`;
        }
        // on an investigation the question is shown and the asker's thinking is not
        if (ticket.kind === "investigation" && review.investigation) {
          return `investigation: "${ticket.goal}"\nquestion: ${review.investigation.question}\n\nThis is the blind first take. ${review.authorName}'s thinking on it (what is known, what is ruled out${review.investigation.findings ? ", what was found" : ""}) is on this ticket, but your user has not given theirs yet. Ask them what THEY think the answer is, or how they would find out, and post it with post-review — then call review-context again and the asker's thinking opens. If they would rather read everything first, call review-context with anyway: true and tell them you skipped the blind take.`;
        }
        return `${ticket.kind}: "${ticket.goal}"\n\nThis is the blind first take. ${review.authorName}'s thoughts (${review.decisions.length} decision(s), ${review.forks.length} fork(s)) are on this ticket, but your user has not taken a position yet. Ask them what THEY think of "${ticket.goal}" and post it with post-review (failed: true asks for changes) — then call review-context again and the thoughts open. If they would rather read everything first, call review-context with anyway: true and tell them you skipped the blind take.`;
      }
      // a reader starting on a review gets its page, the diff read by intent,
      // in their browser (their openReviewPage setting; once a run)
      // its reader: anyone but its author — or, on a review built from
      // assumptions, the one whose AI built it: they are its reader
      const reading = ticket?.kind === "review" && (ticket.createdBy !== me || review.assumed !== undefined);
      const page = reading && reviewStarted ? yield* reviewStarted(ticketId) : null;
      const opened = page === null ? "" : `\n\n${page} — the diff read by intent, in your user's browser. Tell them it is there. (Their openReviewPage setting; if they find it in the way, set-settings turns it off.)`;
      const rows = reviewRows(review, about, me);
      if (about && rows.decisions.length === 0 && rows.forks.length === 0 && (rows.outline?.length ?? 0) === 0 && !rows.bug && !rows.investigation) {
        return `nothing in the why mentions "${about}" — call review-context without 'about' for all ${review.decisions.length} decision(s) and ${review.forks.length} fork(s), or ask ${review.authorName} through their person (send-to-peer, with this ticketId)${opened}`;
      }
      // what readers said on the code, line by line — the review page's comments, in the room
      const said = (yield* SubscriptionRef.get(handle.room.comments)).filter((comment) => comment.ticketId === ticketId && (!about || `${comment.file} ${comment.body} ${comment.detail ?? ""}`.toLowerCase().includes(about.toLowerCase())));
      const comments =
        said.length > 0
          ? {
              comments: said.map((comment) => ({
                by: comment.authorName,
                at: whereOf(comment),
                // an agent reads the AI's longer version, where there is one, as strongly as it asks
                body: comment.detail !== undefined ? withStrength(readStrength(comment.body).strength, comment.detail) : comment.body,
                ...(comment.host ? { onHost: comment.host.url } : {}),
              })),
            }
          : {};
      // a reader's agent reviewing it: remarks on lines belong beside the code, not in the chat
      const drafting = reading ? "\n\nREVIEWING THIS FOR YOUR USER: each remark about particular lines goes on the review page as a draft (review-comments, action draft) — beside the code, for them to accept or decline — not in the chat. Judge the change — its reasons, and whether the code serves them; running the tests is CI's and the author's, not yours." : "";
      // guesses about someone's code: if that someone is reading, they can answer them
      const answer =
        review.assumed && !review.claimed && review.author !== me
          ? `\n\nIF YOUR USER WROTE THIS CODE (${review.assumed.author}'s pull request): they can take this review over — claim-review, with their answer to each guess (confirmed, corrected, wrong) and their own decisions. Ask them first.`
          : "";
      // a review whose branch is one in a stack of the room's reviews: where, and what is below and above
      const stack = ticket?.kind === "review" && review.branch ? stackOf(review.branch, review.base ?? "main", roomEdges(all, yield* SubscriptionRef.get(handle.room.reviews), me, ticket.project)) : null;
      const place = stack ? stackPlace(stack) : null;
      const inStack =
        stack && place
          ? { stack: `${place.at} of ${place.of} — built on ${stack.below.map((step) => step.label).join(" › ") || "the trunk"}${stack.above.length > 0 ? `; built on it: ${stack.above.map((step) => step.label).join(" › ")}` : ""}${stack.split.length > 0 ? `; then split into ${stack.split.map((step) => step.label).join(" / ")}` : ""}` }
          : {};
      return toToon({ ...inStack, ...rows, ...comments }) + opened + drafting + answer;
    }),
});
