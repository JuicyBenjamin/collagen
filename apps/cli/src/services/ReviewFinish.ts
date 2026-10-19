import { Effect, SubscriptionRef } from "effect";
import { isJudged, visibleTo } from "@collagen/p2p";
import type { HostWrite } from "@collagen/review-web/data";
import { IdentityService } from "./Identity";
import { Outbox } from "./Outbox";
import { reviewNamed } from "./ReviewView";

// A review finished on its page, as the reader's agent would: their take on
// someone else's review (post-review), or — on one they filed — closing it,
// accepted as done or dropped. Both go out through the outbox, as the
// agent's do, so they are said in the room as theirs and show in what went.

/** The reader's take on a review: their words, and whether they reject it. */
export const takeReview = Effect.fn("ReviewFinish.take")(function* (ticketId: string, findings: string, failed: boolean) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies HostWrite;
  const me = (yield* IdentityService).identity.pubkey;
  const all = yield* SubscriptionRef.get(found.room.tickets);
  if (!visibleTo(found.ticket, all, me) || !isJudged(found.ticket.kind)) return { error: "this ticket takes no review" } satisfies HostWrite;
  const words = findings.trim();
  if (words.length === 0) return { error: "Say what you think of it." } satisfies HostWrite;
  const peers = yield* SubscriptionRef.get(found.room.roster);
  const members = yield* SubscriptionRef.get(found.room.members);
  const author = found.ticket.createdBy === me ? "the room" : (peers.find((peer) => peer.key === found.ticket.createdBy)?.name ?? members.find((member) => member.key === found.ticket.createdBy)?.name ?? "the room");
  const told = yield* (yield* Outbox).tell({
    roomId: found.roomId,
    to: author,
    title: `${found.ticket.goal} · your review`,
    outgoing: { kind: "post-review", ticketId, findings: words, failed },
  });
  return told.startsWith("failed") ? ({ error: told.replace(/^failed: /, "") } satisfies HostWrite) : ({ ok: true as const } satisfies HostWrite);
});

/** Close a review the reader filed: accepted (done) or dropped. Someone
 *  else's is refused — what they think goes on it as a take. */
export const closeReview = Effect.fn("ReviewFinish.close")(function* (ticketId: string, outcome: "done" | "dropped") {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies HostWrite;
  if (found.ticket.createdBy !== (yield* IdentityService).identity.pubkey) return { error: "it is not yours to close — give your review instead" } satisfies HostWrite;
  const told = yield* (yield* Outbox).tell({
    roomId: found.roomId,
    to: "the room",
    title: `${found.ticket.goal} · closed`,
    outgoing: { kind: "close", ticketId, outcome },
  });
  return told.startsWith("failed") ? ({ error: told.replace(/^failed: /, "") } satisfies HostWrite) : ({ ok: true as const } satisfies HostWrite);
});
