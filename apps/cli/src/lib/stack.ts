import { isClosed, visibleTo, type ReviewContext, type Ticket } from "@collagen/p2p";
import type { Stack, StackStep } from "@collagen/review-web/data";

// The stack a branch sits in: each branch built on another's head, down to
// the trunk, and what is built on it in turn. Pure — the edges come from the
// host's open pull requests (a pull request joins its head to its base) and
// from the room's own reviews (a review names its branch and base), the
// pull request winning where both name the same branch.

/** One branch built on another: a pull request or a review. */
export interface Edge extends StackStep {
  readonly base: string;
}

/** The stack `branch` sits in, or null when it builds on the trunk alone
 *  and nothing builds on it. Below: from the trunk up. Above: the chain on
 *  top of it while there is one way up. Split: where several branches build
 *  on the top of that chain, each of them — the climb stops there. */
export const stackOf = (branch: string, base: string | undefined, edges: ReadonlyArray<Edge>): Stack | null => {
  const byHead = new Map<string, Edge>();
  for (const edge of edges) {
    const had = byHead.get(edge.branch);
    if (!had || (had.kind !== "pull" && edge.kind === "pull")) byHead.set(edge.branch, edge);
  }
  const step = ({ base: _base, ...rest }: Edge): StackStep => rest;
  const self = byHead.get(branch);
  const seen = new Set([branch]);

  const below: Array<StackStep> = [];
  let down = self?.base ?? base;
  // a cycle (two pull requests on each other) stops the walk where it repeats
  let looped = false;
  while (down !== undefined) {
    if (seen.has(down)) {
      looped = true;
      break;
    }
    seen.add(down);
    const edge = byHead.get(down);
    if (!edge) break;
    below.unshift(step(edge));
    down = edge.base;
  }

  const above: Array<StackStep> = [];
  let split: ReadonlyArray<StackStep> = [];
  let up = branch;
  for (;;) {
    const on = [...byHead.values()].filter((edge) => edge.base === up && !seen.has(edge.branch));
    if (on.length === 0) break;
    for (const edge of on) seen.add(edge.branch);
    if (on.length > 1) {
      split = on.map(step);
      break;
    }
    above.push(step(on[0]!));
    up = on[0]!.branch;
  }

  if (below.length === 0 && above.length === 0 && split.length === 0) return null;
  // the trunk heads it: what the bottom of the stack is built on
  if (down !== undefined && !looped) below.unshift({ branch: down, label: down, kind: "trunk" });
  return { below, here: self ? step(self) : { branch, label: branch, kind: "review" }, above, split };
};

/** Where a branch sits in its stack: its place from the bottom, and how
 *  many branches the stack holds — below it, it, the chain on top, and a
 *  split counted once (several tops are one more level). The trunk is not one. */
export interface StackPlace {
  readonly at: number;
  readonly of: number;
}

export const stackPlace = (stack: Stack): StackPlace => {
  const at = stack.below.filter((step) => step.kind !== "trunk").length + 1;
  return { at, of: at + stack.above.length + (stack.split.length > 0 ? 1 : 0) };
};

/** The room's open review tickets in `project` the reader may see, as
 *  branches built on their bases: the stack the room's own reviews make. */
export const roomEdges = (all: ReadonlyMap<string, Ticket>, reviews: ReadonlyArray<ReviewContext>, me: string, project: string): ReadonlyArray<Edge> =>
  reviews.flatMap((review): ReadonlyArray<Edge> => {
    const ticket = all.get(review.ticketId);
    if (!ticket || ticket.kind !== "review" || isClosed(ticket) || !review.branch || ticket.project.trim().toLowerCase() !== project.trim().toLowerCase() || !visibleTo(ticket, all, me)) return [];
    return [{ branch: review.branch, base: review.base ?? "main", label: ticket.title ?? ticket.goal, url: `/review/${ticket.id}`, kind: "review" }];
  });

/** Each open review the reader sees that sits in a stack of the room's own
 *  reviews, by ticket id: its place and the stack's size. Pull requests on
 *  the host are not counted here (the review page adds them). */
export const roomStackPlaces = (all: ReadonlyMap<string, Ticket>, reviews: ReadonlyArray<ReviewContext>, me: string): ReadonlyMap<string, StackPlace> => {
  const places = new Map<string, StackPlace>();
  const byProject = new Map<string, ReadonlyArray<Edge>>();
  for (const review of reviews) {
    const ticket = all.get(review.ticketId);
    if (!ticket || ticket.kind !== "review" || !review.branch || isClosed(ticket) || !visibleTo(ticket, all, me)) continue;
    const key = ticket.project.trim().toLowerCase();
    const edges = byProject.get(key) ?? roomEdges(all, reviews, me, ticket.project);
    byProject.set(key, edges);
    const stack = stackOf(review.branch, review.base ?? "main", edges);
    if (stack) places.set(ticket.id, stackPlace(stack));
  }
  return places;
};
