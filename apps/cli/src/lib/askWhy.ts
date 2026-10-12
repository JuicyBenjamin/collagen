import { ticketName, type ReviewContext, type ReviewDecision, type ReviewFork, type Ticket } from "@collagen/p2p";
import type { HostMerge } from "../services/RepoHost";

// Why some code is the way it is: the merges that brought it, and what was
// decided and assumed on the tickets they came from. Pure — the branch's
// history is git's, the merges the host's, the why the room's.
//
// A merge lands on the branch's first-parent history as one commit (a merge
// commit, a squash) or as its own commits in a row (a rebase, a
// fast-forward), ending at its `commit`. A commit on that history is the
// merge's that covers it; one inside a merged branch is the merge's that
// covers the first commit on that history to hold it — finding that commit
// takes git, so it is the caller's.

/** How many commits of the first-parent history a merge put there, its own commit the newest. */
const span = (merge: HostMerge): number => (merge.kind === "rebase" || merge.kind === "fast-forward" ? Math.max(1, merge.commits) : 1);

/** The merge that put `commit` on the first-parent history `chain` (newest
 *  first), if any of `merges` did. */
export const mergeOn = (chain: ReadonlyArray<string>, merges: ReadonlyArray<HostMerge>, commit: string): HostMerge | undefined => {
  const depthOf = new Map(chain.map((sha, depth) => [sha, depth] as const));
  const depth = depthOf.get(commit);
  if (depth === undefined) return undefined;
  // of the merges covering it, the newest: the one nearest the top of the chain
  let nearest: { readonly merge: HostMerge; readonly depth: number } | undefined;
  for (const merge of merges) {
    const top = depthOf.get(merge.commit);
    if (top !== undefined && top <= depth && depth < top + span(merge) && (!nearest || top > nearest.depth)) nearest = { merge, depth: top };
  }
  return nearest?.merge;
};

/** The merges that put any of `touched` on `chain`, the latest first. */
export const mergesTouching = (chain: ReadonlyArray<string>, merges: ReadonlyArray<HostMerge>, touched: ReadonlyArray<string>): ReadonlyArray<HostMerge> => {
  const hit = new Set(touched.flatMap((commit) => mergeOn(chain, merges, commit)?.number ?? []));
  return merges.filter((merge) => hit.has(merge.number)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
};

/** Of a ticket's why, at most this many decisions and forks are given back — the rest by review-context. */
export const DECISIONS_EACH = 5;
export const FORKS_EACH = 3;

/** "apps/x.ts:12-20" → "apps/x.ts" */
const fileOf = (where: string): string => where.replace(/:\d[\d,-]*$/, "").trim();
/** Whether a pointer is to `file` (repo-relative), however much of the path it spells. */
const pointsAt = (where: string, file: string): boolean => {
  const pointed = fileOf(where);
  return pointed.length > 0 && (pointed === file || file.endsWith(`/${pointed}`) || pointed.endsWith(`/${file}`));
};

/** Of `items`, those about `file` when any are, else all — at most `max`. */
const pick = <T>(items: ReadonlyArray<T>, pointers: (item: T) => ReadonlyArray<string>, file: string | undefined, max: number): ReadonlyArray<T> => {
  const about = file ? items.filter((item) => pointers(item).some((where) => pointsAt(where, file))) : [];
  return (about.length > 0 ? about : items).slice(0, max);
};

/** Where a guess stands: told by its author (""), still a guess, or what the code's author made of it. */
const standing = (review: ReviewContext, point: ReviewDecision | ReviewFork): string =>
  review.claimed ? (point.verdict ?? (point.basis !== undefined ? "guess" : "")) : review.assumed ? (point.confidence ? `guess, ${point.confidence}` : "guess") : "";

/** How the why on a ticket came to be. */
const told = (review: ReviewContext | undefined): string =>
  !review ? "not here yet" : review.claimed ? "guessed, then answered by the code's author" : review.assumed ? `guessed by ${review.authorName}'s AI` : "told";

/** The merges asked about, each with its tickets, as rows for an agent:
 *  every merge and ticket named, and of each ticket's why the decisions and
 *  forks about `file` (repo-relative) when it has some, else its first —
 *  a few at most, with what is left counted. */
export const whyRows = (
  picked: ReadonlyArray<{ readonly merge: HostMerge; readonly tickets: ReadonlyArray<Ticket> }>,
  reviews: ReadonlyMap<string, ReviewContext>,
  file: string | undefined,
  nameFor: (key: string) => string,
) => {
  const tickets = picked.flatMap(({ merge, tickets: from }) => from.map((ticket) => ({ merge, ticket, review: reviews.get(ticket.id) })));
  const shown = tickets.map(({ ticket, review }) => ({
    id: ticket.id,
    decisions: review ? pick(review.decisions, (decision) => decision.where, file, DECISIONS_EACH) : [],
    forks: review ? pick(review.forks, (fork) => [fork.at], file, FORKS_EACH) : [],
  }));
  return {
    merges: picked.map(({ merge, tickets: from }) => ({ pull: merge.number, title: merge.title, branch: merge.branch, merged: merge.at, url: merge.url, tickets: from.length })),
    tickets: tickets.map(({ merge, ticket, review }, index) => {
      const left = review ? [review.decisions.length - shown[index]!.decisions.length, review.forks.length - shown[index]!.forks.length] : [0, 0];
      return {
        pull: merge.number,
        id: ticket.id,
        title: ticketName(ticket),
        by: nameFor(ticket.createdBy),
        why: told(review),
        summary: review?.summary ?? "",
        more: left[0]! + left[1]! > 0 ? `${left[0]} decision(s), ${left[1]} fork(s)` : "",
      };
    }),
    decisions: tickets.flatMap(({ ticket, review }, index) =>
      review
        ? shown[index]!.decisions.map((decision) => ({
            ticket: ticket.id,
            id: decision.id,
            title: decision.title ?? "",
            what: decision.what,
            userWhy: decision.userWhy ?? "",
            agentWhy: decision.agentWhy ?? "",
            where: decision.where.join(" "),
            standing: standing(review, decision),
          }))
        : [],
    ),
    forks: tickets.flatMap(({ ticket, review }, index) =>
      review ? shown[index]!.forks.map((fork) => ({ ticket: ticket.id, id: fork.id, at: fork.at, chose: fork.chose, instead: fork.instead, why: fork.why, standing: standing(review, fork) })) : [],
    ),
  };
};
