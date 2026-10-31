import { Effect, SubscriptionRef } from "effect";
import { levelOf } from "../lib/steering";
import { isJudged, visibleTo } from "@collagen/p2p";
import type { HostWrite, MergeView } from "@collagen/review-web/data";
import type { MergeFor } from "@collagen/p2p";
import { mergeForOf, withMergeFor } from "../lib/merging";
import { openParents } from "../lib/parents";
import { StateStore } from "./StateStore";
import { IdentityService } from "./Identity";
import { Outbox } from "./Outbox";
import { reviewNamed } from "./ReviewView";

// A review finished on its page, as the reader's agent would: their take on
// someone else's review (post-review), or — on one they filed — closing it,
// accepted as done or dropped. Both go out through the outbox, as the
// agent's do, so they are said in the room as theirs and show in what went.

/** The reader's take on a review: their words, and whether they reject it —
 *  or, `comment`, approve nothing. */
export const takeReview = Effect.fn("ReviewFinish.take")(function* (ticketId: string, findings: string, failed: boolean, comment = false) {
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
    outgoing: { kind: "post-review", ticketId, findings: words, failed, ...(comment ? { comment: true } : {}) },
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

/** What a review the reader filed grew from, still open and theirs to close —
 *  offered beside Accept as something they may close too, never closed on
 *  its own. */
export const parentsOf = Effect.fn("ReviewFinish.parents")(function* (ticketId: string) {
  const found = yield* reviewNamed(ticketId);
  const me = (yield* IdentityService).identity.pubkey;
  if (!found || found.ticket.createdBy !== me) return [];
  return openParents(found.ticket, yield* SubscriptionRef.get(found.room.tickets), me);
});

/** What the review page offers beside Accept: the parents, and whether the
 *  person's setting has them ticked. */
export const parentsView = Effect.fn("ReviewFinish.parentsView")(function* (ticketId: string) {
  const closing = levelOf(yield* (yield* StateStore).get, "close", "mine", (yield* reviewNamed(ticketId))?.roomId);
  return { tickets: yield* parentsOf(ticketId), ticked: closing === "act" || closing === "auto" };
});

/** Close, as done, a ticket a review the reader filed grew from — the
 *  reader's own act beside their Accept. Only one of its parents, theirs and open. */
export const closeParent = Effect.fn("ReviewFinish.closeParent")(function* (ticketId: string, parentId: string) {
  const parents = yield* parentsOf(ticketId);
  const parent = parents.find((candidate) => candidate.id === parentId);
  const found = yield* reviewNamed(ticketId);
  if (!found || !parent) return { error: "that is not an open ticket of yours this review grew from" } satisfies HostWrite;
  const told = yield* (yield* Outbox).tell({
    roomId: found.roomId,
    to: "the room",
    title: `${parent.title} · closed`,
    outgoing: { kind: "close", ticketId: parentId, outcome: "done", reason: `its review, "${found.ticket.title ?? found.ticket.goal}", was accepted` },
  });
  return told.startsWith("failed") ? ({ error: told.replace(/^failed: /, "") } satisfies HostWrite) : ({ ok: true as const } satisfies HostWrite);
});

/** How merging stands for a review the reader filed: its own setting, its
 *  room's, and the one in effect. */
export const mergeView = Effect.fn("ReviewFinish.mergeView")(function* (ticketId: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return null;
  const state = yield* (yield* StateStore).get;
  return {
    own: state.merging?.tickets?.[ticketId] ?? null,
    room: state.merging?.rooms?.[found.roomId] ?? state.merging?.default ?? ("off" as const),
    effect: mergeForOf(state, found.roomId, ticketId),
  } satisfies MergeView;
});

/** Set a review's own merge setting — null gives it back to its room's. Only the author's. */
export const setMerge = Effect.fn("ReviewFinish.setMerge")(function* (ticketId: string, level: MergeFor | null) {
  const found = yield* reviewNamed(ticketId);
  if (!found || found.ticket.createdBy !== (yield* IdentityService).identity.pubkey) return null;
  yield* (yield* StateStore).update((state) => withMergeFor(state, { ticket: ticketId }, level));
  return yield* mergeView(ticketId);
});
