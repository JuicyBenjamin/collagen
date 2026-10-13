import { isJudged, isTake, visibleTo, type ReviewComment, type ReviewContext, type Ticket } from "@collagen/p2p";
import type { HostMerge, RepoHost } from "../services/RepoHost";
import { projectKey } from "./projects";

// Which collagen tickets each merge came from. Pure — the merges are the
// host's, the reviews the room's. A review ticket names where its code is:
// the pull request its link names, a branch, and the commits its comments
// were written at. Tried in that order:
//
// - the pull request — exact, whatever kind of merge, and it alone decides:
//   a ticket whose pull request is not among the merges (not merged, or
//   merged before those read) is tied to none, never to another pull
//   request of a branch name used again;
// - its branch — what survives a squash or a rebase, which rewrite every
//   commit: the first merge of it after the ticket was filed. A branch name
//   is used again, so a merge before the ticket is someone else's work — a
//   merged pull request reviewed afterwards is found by its link;
// - a commit it was read at — the last resort, and only where the merge kept
//   it: a fast-forward or a rebase's last commit, never a squash.
//
// A ticket is tied to one merge at most; a merge can come from several
// (a branch reviewed again, a stack reviewed in parts). A merge from none
// has no tickets — the usual case, not a gap.

/** A review ticket, as much of it as says where its code was. */
export interface ReviewedCode {
  readonly ticketId: string;
  /** when the ticket was filed; unknown on an old one */
  readonly filedAt?: number;
  /** the number of the pull request its link names */
  readonly pull?: number;
  readonly branch?: string;
  /** the commits it was read at (its comments') */
  readonly commits?: ReadonlyArray<string>;
}

/** A merge, and the tickets it came from in the order they were filed — none, often. */
export interface MergeTickets {
  readonly merge: HostMerge;
  readonly tickets: ReadonlyArray<string>;
}

const mergedAt = (m: HostMerge): number => Date.parse(m.at);

/** Of the merges of one branch, the one a ticket filed at `filedAt` was
 *  about: the first after it; of an old ticket, filed when nobody noted
 *  it, the latest. */
const forFiling = (merges: ReadonlyArray<HostMerge>, filedAt: number | undefined): HostMerge | undefined => {
  const byTime = [...merges].sort((a, b) => mergedAt(a) - mergedAt(b));
  return filedAt === undefined ? byTime.at(-1) : byTime.find((m) => mergedAt(m) >= filedAt);
};

/** The merge a ticket came to, if any. */
const mergeOf = (code: ReviewedCode, merges: ReadonlyArray<HostMerge>): HostMerge | undefined => {
  if (code.pull !== undefined) return merges.find((m) => m.number === code.pull);
  const byBranch = code.branch ? forFiling(merges.filter((m) => m.branch === code.branch), code.filedAt) : undefined;
  if (byBranch) return byBranch;
  const commits = new Set(code.commits ?? []);
  return commits.size > 0 ? merges.find((m) => m.kind !== "squash" && m.kind !== "merge" && commits.has(m.commit)) : undefined;
};

/** Every merge, in the order given, with the tickets it came from. */
export const ticketsOfMerges = (merges: ReadonlyArray<HostMerge>, reviewed: ReadonlyArray<ReviewedCode>): ReadonlyArray<MergeTickets> => {
  const found = new Map<number, Array<ReviewedCode>>();
  for (const code of reviewed) {
    const m = mergeOf(code, merges);
    if (m) found.set(m.number, [...(found.get(m.number) ?? []), code]);
  }
  return merges.map((merge) => ({
    merge,
    tickets: (found.get(merge.number) ?? [])
      .sort((a, b) => (a.filedAt ?? 0) - (b.filedAt ?? 0) || (a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0))
      .map((c) => c.ticketId),
  }));
};

/** A project's review tickets that `me` may see, as where their code was —
 *  what `ticketsOfMerges` ties to merges. `host` is the project's; the
 *  project is matched however it is cased. */
export const reviewedCode = (
  project: string,
  all: ReadonlyMap<string, Ticket>,
  reviews: ReadonlyArray<ReviewContext>,
  comments: ReadonlyArray<ReviewComment>,
  me: string,
  host: Pick<RepoHost, "pullIn">,
): ReadonlyArray<ReviewedCode> => {
  const why = new Map(reviews.map((r) => [r.ticketId, r] as const));
  const key = projectKey(project);
  return [...all.values()].flatMap((t): ReadonlyArray<ReviewedCode> => {
    if (t.kind !== "review" || projectKey(t.project) !== key || !visibleTo(t, all, me)) return [];
    const r = why.get(t.id);
    const pull = r?.link ? host.pullIn(r.link) : null;
    const commits = [...new Set(comments.filter((c) => c.ticketId === t.id).map((c) => c.commit))];
    return [
      {
        ticketId: t.id,
        ...(t.filedAt !== undefined ? { filedAt: t.filedAt } : {}),
        ...(pull !== null ? { pull } : {}),
        ...(r?.branch ? { branch: r.branch } : {}),
        ...(commits.length > 0 ? { commits } : {}),
      },
    ];
  });
};

/** The tickets `ids` came from, and theirs, with them: a review from a
 *  task, from a plan, from a proposal — each once, what it grew from before
 *  it; only those `me` may see. */
export const lineage = (ids: ReadonlyArray<string>, all: ReadonlyMap<string, Ticket>, me: string): ReadonlyArray<Ticket> => {
  const seen = new Set<string>();
  const out: Array<Ticket> = [];
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const t = all.get(id);
    if (!t) return;
    (t.from ?? []).forEach(visit);
    if (visibleTo(t, all, me)) out.push(t);
  };
  ids.forEach(visit);
  return out;
};

/** Whether `me` reads a ticket's why: on someone else's plan, proposal or
 *  bug, not until they have posted their own take — the blind first take. */
export const whyOpen = (t: Ticket, me: string): boolean =>
  !isJudged(t.kind) || t.kind === "review" || t.createdBy === me || t.steps.some((s) => isTake(s) && s.owner === me && (s.status === "settled" || s.status === "failed"));
