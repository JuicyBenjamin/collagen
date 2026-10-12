import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer, SubscriptionRef } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { isClosed, roomProjects, visibleTo, type ReviewContext, type Ticket } from "@collagen/p2p";
import { defaultBranchOf, gitDir, repoWebUrl } from "../lib/gitInfo";
import { firstRef, run } from "../lib/gitRun";
import type { HostView, HostWrite, ReviewPageData, ReviewPageHead, SinceResult, Verdict, WholeFileResult } from "@collagen/review-web/data";
import { parseDiff } from "../lib/reviewView";
import { importsAmong } from "../lib/imports";
import { groupByUnit, uncovered, type Imports } from "../lib/units";
import { stackOf, type Edge } from "../lib/stack";
import { IdentityService } from "./Identity";
import { hostOf, type HostPull, type LineSpot, type RepoHost } from "./RepoHost";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

// The review page's data: the diff of a review ticket's branch, read from
// the reviewer's own clone, laid out under the why (lib/reviewView). Served
// by the running instance beside /mcp, on loopback, read-only — a take still
// goes back through the person's agent (post-review), one path into the log.

/** Where `branch` left the nearest of `refs` (bases it may sit on):
 *  their merge-bases with it, the one each other is an ancestor of — a stale
 *  copy of a base, or a base merged elsewhere since, left it earlier. Where
 *  they part ways, the first's. With the ref it came from, for the reason. */
const leftAt = (path: string, refs: ReadonlyArray<string>, branch: string) =>
  Effect.gen(function* () {
    const points = (yield* Effect.forEach(refs, (ref) => run("git", ["merge-base", ref, branch], path, 5_000).pipe(Effect.map((out) => ({ ref, at: out?.trim() ?? "" }))))).filter((point) => point.at.length > 0);
    const first = points[0];
    if (!first || points.length === 1) return first ?? null;
    const nearest = (yield* run("git", ["merge-base", "--independent", ...new Set(points.map((point) => point.at))], path, 5_000))?.trim().split("\n") ?? [];
    return nearest.length === 1 ? (points.find((point) => point.at === nearest[0]) ?? first) : first;
  });

/** The diff of a branch against its base from the clone at `path`: fetch
 *  first (the reviewer may not have the branch yet), then the refs as they
 *  are, local and origin's. The base is where the branch left it — read
 *  against the freshest copy of it, and against `elsewhere` (the default
 *  branch; where the base was merged, when its own tip is no longer under
 *  the branch), so a branch rebased over other work shows its own changes
 *  alone. Null with the reason when it cannot. */
const fromClone = (path: string, base: string, branch: string, fetch = true, pullRef?: (pull: number) => string, merged?: Effect.Effect<string | null>) =>
  Effect.gen(function* () {
    if (!gitDir(path)) return { diff: null, why: `${path} is not a git repository` };
    // best effort: offline, or a remote that needs a password, still has whatever is local
    if (fetch) yield* run("git", ["fetch", "--quiet", "--no-tags", "origin"], path, 20_000);
    // a pull request from a fork has its head on the fork: its host keeps it
    // in this repository too (its pullRef), read here as origin/pr/<n>
    const pullMatch = /^pr\/(\d+)$/.exec(branch);
    if (fetch && pullMatch && pullRef) yield* run("git", ["fetch", "--quiet", "--no-tags", "origin", `+${pullRef(Number(pullMatch[1]))}:refs/remotes/origin/pr/${pullMatch[1]}`], path, 20_000);
    const branchRef = yield* firstRef(path, [branch, `origin/${branch}`]);
    if (!branchRef) return { diff: null, why: `the branch ${branch} is not in your clone at ${path}, nor on its origin` };
    const own = (yield* Effect.forEach([base, `origin/${base}`], (ref) => firstRef(path, [ref]))).filter((ref): ref is string => ref !== null);
    // the base's tip under the branch: it is where the branch sits, nothing moved
    const under = own.length > 0 && (yield* run("git", ["merge-base", "--is-ancestor", own[0]!, branchRef], path, 5_000)) !== null;
    const into = under || !merged ? null : yield* merged;
    const fallback = defaultBranchOf(path);
    const elsewhere = [...(into ? [`origin/${into}`] : []), ...(fallback && fallback !== base ? [`origin/${fallback}`] : [])];
    const refs = [...own, ...(yield* Effect.forEach(elsewhere, (ref) => firstRef(path, [ref]))).filter((ref): ref is string => ref !== null)];
    if (own.length === 0 && !into) return { diff: null, why: `the base ${base} is not in your clone at ${path}, nor on its origin` };
    const left = yield* leftAt(path, refs, branchRef);
    if (!left) return { diff: null, why: `${branch} shares no history with ${base} in ${path}` };
    const diff = yield* run("git", ["diff", "--no-color", "--no-ext-diff", "-U3", `${left.at}..${branchRef}`], path, 30_000);
    const commit = (yield* run("git", ["rev-parse", `${branchRef}^{commit}`], path, 5_000))?.trim() || undefined;
    return diff === null ? { diff: null, why: `git diff ${left.ref}...${branchRef} failed in ${path}` } : { diff, why: `${left.ref}...${branchRef} from your clone at ${path}`, commit };
  });

/** Is `commit` a commit the clone at `path` has? */
export const commitIn = (path: string, commit: string) => run("git", ["cat-file", "-e", `${commit}^{commit}`], path, 5_000).pipe(Effect.map((ok) => ok !== null));

const short = (commit: string) => commit.slice(0, 7);

/** A pull request's diff from the clone at `path`, read by its commits, not
 *  its branch's name — what is left of it once it is merged and its branch
 *  deleted: its last commit (fetched from where its host keeps it, when the
 *  clone lacks it) against the base as it was just before the merge. */
const fromPull = (path: string, pull: HostPull, host: RepoHost, fetch: boolean) =>
  Effect.gen(function* () {
    if (fetch && !(yield* commitIn(path, pull.head))) yield* run("git", ["fetch", "--quiet", "--no-tags", "origin", `+${host.pullRef(pull.number)}:refs/remotes/origin/pr/${pull.number}`], path, 20_000);
    if (!(yield* commitIn(path, pull.head))) return { diff: null, why: `#${pull.number}'s last commit ${short(pull.head)} is not in your clone, nor on ${host.name}` };
    // merged: read against its merge's first parent, the base as it was
    // then, so the merge itself does not hide it (a fast-forward has none:
    // its head is the merge). Diffed from the merge-base, so a squash or a
    // rebase reads the same.
    const before = pull.merged && pull.merged !== pull.head && (yield* commitIn(path, pull.merged)) ? `${pull.merged}^1` : null;
    const baseRef = before ?? (yield* firstRef(path, [pull.base, `origin/${pull.base}`]));
    if (!baseRef) return { diff: null, why: `the base ${pull.base} is not in your clone, nor on its origin` };
    const diff = yield* run("git", ["diff", "--no-color", "--no-ext-diff", "-U3", `${baseRef}...${pull.head}`], path, 30_000);
    if (diff === null) return { diff: null, why: `git diff ${baseRef}...${short(pull.head)} failed in ${path}` };
    return { diff, why: `#${pull.number} (${baseRef === before ? `merged as ${short(pull.merged!)}` : pull.base}...${short(pull.head)}) from your clone at ${path}`, commit: pull.head };
  });

/** Where a review's diff came from, and why when it has none. */
export type ReadDiff =
  | { readonly kind: "clone"; readonly diff: string; readonly why: string; readonly commit: string | undefined }
  | { readonly kind: "host"; readonly diff: string; readonly why: string }
  | { readonly kind: "none"; readonly why: string };

/** A review's diff: its branch against its base in the reader's clone
 *  (`clone`; `noClone` says why there is none), else on its host. When that
 *  holds no change — the branch gone, or merged into the base — the pull
 *  request the review is, by its commits: in the clone, else the host's own
 *  diff of it. An empty diff is none: the reason names what is missing. */
export const readDiff = (
  review: { readonly base?: string; readonly branch?: string; readonly link?: string },
  clone: { readonly path: string } | { readonly noClone: string },
  fetch: boolean,
  host: RepoHost | undefined = review.link ? hostOf(review.link) : undefined,
) =>
  Effect.gen(function* () {
    if (!review.branch) return { kind: "none", why: "this review names no branch" } satisfies ReadDiff;
    const base = review.base ?? "main";
    const branch = review.branch;
    let why: string;
    // the branch unread (no clone, or not in it): the host may still have it
    let unread = true;
    if ("path" in clone) {
      // the base merged since, by its own pull request: what it went into
      // (asked by the repository, never a link naming the review's own pull request)
      const repo = repoWebUrl(clone.path) ?? (review.link && host?.pullIn(review.link) === null ? review.link : null);
      const merged = host && repo ? host.pull(repo, base).pipe(Effect.map((result) => ("pull" in result && result.pull.merged ? result.pull.base : null))) : undefined;
      const got = yield* fromClone(clone.path, base, branch, fetch, host?.pullRef, merged);
      if (got.diff) return { kind: "clone", diff: got.diff, why: got.why, commit: "commit" in got ? got.commit : undefined } satisfies ReadDiff;
      unread = got.diff === null;
      why = got.diff === null ? got.why : `${branch} has no changes against ${base}`;
    } else why = clone.noClone;
    if (!host || !review.link) return { kind: "none", why } satisfies ReadDiff;
    const link = review.link;
    const compare = (note: string) =>
      host.compare(link, base, branch).pipe(Effect.map((hosted) => (hosted ? ({ kind: "host", diff: hosted, why: `${base}...${branch} from ${host.name} (${note})` } satisfies ReadDiff) : null)));
    if (!("path" in clone)) {
      const hosted = yield* compare(`no clone: ${why}`);
      if (hosted) return hosted;
    }
    const named = yield* host.pull(link, branch);
    if ("pull" in named && "path" in clone) {
      // in the clone first: a commit there is what a comment can be drafted on
      const got = yield* fromPull(clone.path, named.pull, host, fetch);
      if (got.diff) return { kind: "clone", diff: got.diff, why: got.why, commit: got.commit } satisfies ReadDiff;
      why = `${why}; ${got.diff === null ? got.why : `#${named.pull.number} has no changes`}`;
    }
    if (unread && "path" in clone) {
      const hosted = yield* compare(why);
      if (hosted) return hosted;
    }
    if ("pull" in named) {
      const hosted = yield* host.pullDiff(link, named.pull.number);
      if (hosted) return { kind: "host", diff: hosted, why: `#${named.pull.number} from ${host.name} (${why})` } satisfies ReadDiff;
    }
    return { kind: "none", why } satisfies ReadDiff;
  });

/** The code a review's branch holds, for reading it as code (type hints,
 *  definitions): the reader's clone of the project, and the branch's ref in
 *  it when it still has one — local first, then origin's, fetched by the
 *  page's data request. Or why there is none, in words for the page. */
export const reviewTree = Effect.fn("ReviewView.tree")(function* (ticketId: string) {
  const rooms = yield* Rooms;
  const store = yield* StateStore;
  for (const handle of yield* SubscriptionRef.get(rooms.handles)) {
    const ticket = (yield* SubscriptionRef.get(handle.room.tickets)).get(ticketId);
    if (!ticket) continue;
    const review = (yield* SubscriptionRef.get(handle.room.reviews)).find((candidate) => candidate.ticketId === ticketId);
    if (!review?.branch) return "this review names no branch";
    const project = roomProjects(yield* store.get, handle.id).find((candidate) => candidate.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
    if (!project || !gitDir(project.path)) return `no clone of "${ticket.project}" on this machine to read the code from`;
    // a branch deleted once its pull request merged: the clone still holds
    // the code (its last commit, fetched from the host by the page's data)
    const ref = yield* firstRef(project.path, [review.branch, `origin/${review.branch}`]);
    return { projectPath: project.path, ...(ref ? { ref } : {}) };
  }
  return `no review ticket ${ticketId} in your rooms`;
});

/** A path from the diff: relative and inside the tree. */
export const treePathOk = (file: string | undefined): file is string =>
  file !== undefined && file.length > 0 && file.length < 500 && !isAbsolute(file) && !file.split(/[\\/]/).includes("..") && !file.includes("\0");

/** The most of a file the page is given whole: past this it is a generated
 *  file or a bundle, not something a reviewer reads top to bottom. */
const WHOLE_MAX = 1024 * 1024;

/** A file whole at `commit` — the commit the page's diff was read at, not
 *  the branch's tip now, so its marks and scroll target match — from the
 *  reader's clone, `git show <commit>:<path>`: the working tree is never read. */
export const wholeFile = Effect.fn("ReviewView.wholeFile")(function* (ticketId: string, file: string, commit: string) {
  const tree = yield* reviewTree(ticketId);
  if (typeof tree === "string") return { error: tree } satisfies WholeFileResult;
  if ((yield* run("git", ["cat-file", "-e", `${commit}^{commit}`], tree.projectPath, 5_000)) === null) return { error: "the commit this page shows is not in your clone" } satisfies WholeFileResult;
  const text = yield* run("git", ["show", `${commit}:${file}`], tree.projectPath, 10_000);
  if (text === null) return { error: `${file} is not in the branch` } satisfies WholeFileResult;
  if (text.length > WHOLE_MAX) return { error: `${file} is over a megabyte — too big to read whole here` } satisfies WholeFileResult;
  if (text.includes("\0")) return { error: `${file} is not text` } satisfies WholeFileResult;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return { lines } satisfies WholeFileResult;
});

/** A commit as the page names it: a full or abbreviated hash, nothing else. */
export const commitOk = (commit: string | undefined): commit is string => commit !== undefined && /^[0-9a-f]{7,40}$/.test(commit);

/** What changed in one file from the commit the reader viewed it at (`from`)
 *  to the commit the page shows (`to`) — exactly those two, never the
 *  branch's tip, so the changes sit where the page's hunks are. After a
 *  rebase this includes what the base brought in; a commit gone with a
 *  force-push says so. */
export const sinceViewed = Effect.fn("ReviewView.since")(function* (ticketId: string, file: string, from: string, to: string) {
  const tree = yield* reviewTree(ticketId);
  if (typeof tree === "string") return { error: tree } satisfies SinceResult;
  const known = yield* run("git", ["cat-file", "-e", `${from}^{commit}`], tree.projectPath, 5_000);
  if (known === null) return { error: "the commit you viewed it at is no longer in your clone — the branch was rewritten" } satisfies SinceResult;
  if ((yield* run("git", ["cat-file", "-e", `${to}^{commit}`], tree.projectPath, 5_000)) === null) return { error: "the commit this page shows is not in your clone" } satisfies SinceResult;
  const diff = yield* run("git", ["diff", "--no-color", "--no-ext-diff", "-U3", from, to, "--", file], tree.projectPath, 15_000);
  if (diff === null) return { error: `git diff failed for ${file}` } satisfies SinceResult;
  return { hunks: parseDiff(diff).map((hunk) => ({ ...hunk, id: `since:${hunk.id}` })) } satisfies SinceResult;
});

/** The commit `ref` names in the clone at `path`, now — or null. */
/** What the author's units leave out, said back to the agent that named them:
 *  the changed files with changes in no unit, read from its own clone (not
 *  fetched — the branch is the author's). Empty when the review names no
 *  unit or its diff cannot be read: there is nothing to say then. */
export const unitCoverageNote = (path: string, review: { readonly base?: string; readonly branch?: string; readonly units?: ReadonlyArray<{ readonly where: ReadonlyArray<string> }> }) =>
  Effect.gen(function* () {
    if (!review.branch || !review.units || review.units.length === 0) return "";
    const got = yield* fromClone(path, review.base ?? "main", review.branch, false);
    if (got.diff === null) return "";
    const left = uncovered(review.units, parseDiff(got.diff));
    if (left.length === 0) return "";
    const shown = left.slice(0, 8).join(", ") + (left.length > 8 ? ` and ${left.length - 8} more` : "");
    return `\nNOTE FOR YOU, NOT FOR YOUR USER: no unit covers the changes in ${shown} — the page puts them under the decision that points at them, else under "Not explained". If they belong to a unit, call ask-review with this ticketId and that unit (same id) with them in its 'where'.`;
  });

export const commitOf = (path: string, ref: string) => run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], path, 5_000).pipe(Effect.map((output) => output?.trim() || null));

/** The review's own part of the page — ticket, why, links — read from the
 *  room alone: no clone, no diff, so it is there at once, before the code is. */
const headOf = (ticket: Ticket, review: ReviewContext): ReviewPageHead => {
  const base = review.base ?? "main";
  const host = review.link ? hostOf(review.link) : undefined;
  return {
    ticket: { id: ticket.id, ...(ticket.title ? { title: ticket.title } : {}), goal: ticket.goal, kind: ticket.kind, project: ticket.project },
    review: { summary: review.summary, branch: review.branch, base: review.base, link: review.link, authorName: review.authorName, decisions: review.decisions, forks: review.forks, ...(review.assumed ? { assumed: review.assumed } : {}), ...(review.claimed ? { claimed: review.claimed } : {}), ts: review.ts },
    links: host && review.link ? host.links(review.link, base, review.branch) : review.link ? [{ label: "link", url: review.link }] : [],
  };
};

/** The review without its diff: what the page stands on while the code is read. */
export const reviewHead = Effect.fn("ReviewView.head")(function* (ticketId: string) {
  const rooms = yield* Rooms;
  for (const handle of yield* SubscriptionRef.get(rooms.handles)) {
    const ticket = (yield* SubscriptionRef.get(handle.room.tickets)).get(ticketId);
    if (!ticket) continue;
    const review = (yield* SubscriptionRef.get(handle.room.reviews)).find((candidate) => candidate.ticketId === ticketId);
    return review ? headOf(ticket, review) : null;
  }
  return null;
});

export const reviewData = Effect.fn("ReviewView.data")(function* (ticketId: string) {
  const rooms = yield* Rooms;
  const store = yield* StateStore;
  for (const handle of yield* SubscriptionRef.get(rooms.handles)) {
    const ticket = (yield* SubscriptionRef.get(handle.room.tickets)).get(ticketId);
    if (!ticket) continue;
    const review = (yield* SubscriptionRef.get(handle.room.reviews)).find((candidate) => candidate.ticketId === ticketId);
    if (!review) return null;
    const project = roomProjects(yield* store.get, handle.id).find((candidate) => candidate.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
    const got = yield* readDiff(review, project ? { path: project.path } : { noClone: `you have not located "${ticket.project}" on this machine (the projects panel)` }, true);
    const source: ReviewPageData["source"] = { kind: got.kind, detail: got.why };
    const diff = got.kind === "none" ? null : got.diff;
    const commit = got.kind === "clone" ? got.commit : undefined;
    // which changed files import which, as the branch has them in the clone:
    // what groups the code no unit names, and orders the units
    const hunks = diff === null ? [] : parseDiff(diff);
    let imports: Imports = new Map();
    if (project && commit && hunks.length > 0) {
      const files = [...new Set(hunks.map((hunk) => hunk.file))];
      const texts = new Map<string, string | null>();
      for (const file of files) texts.set(file, yield* run("git", ["show", `${commit}:${file}`], project.path, 5_000));
      imports = importsAmong(files, (file) => texts.get(file) ?? null);
    }
    return {
      ...headOf(ticket, review),
      source,
      ...(source.kind === "clone" && commit ? { commit } : {}),
      grouped: diff === null ? null : groupByUnit(review, hunks, imports),
    } satisfies ReviewPageData;
  }
  return null;
});

/** A review ticket on this machine: the ticket, its why, and the project's
 *  clone when this machine has located it. */
export const reviewNamed = (ticketId: string) =>
  Effect.gen(function* () {
    const rooms = yield* Rooms;
    const store = yield* StateStore;
    for (const handle of yield* SubscriptionRef.get(rooms.handles)) {
      const ticket = (yield* SubscriptionRef.get(handle.room.tickets)).get(ticketId);
      if (!ticket) continue;
      const review = (yield* SubscriptionRef.get(handle.room.reviews)).find((candidate) => candidate.ticketId === ticketId);
      if (!review) return null;
      const project = roomProjects(yield* store.get, handle.id).find((candidate) => candidate.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
      return { room: handle.room, ticket, review, project };
    }
    return null;
  });

/** Where a review's code is hosted: the link it names, else the clone's own
 *  remote — a review filed without a link is still on its host. */
export const hostLink = (review: ReviewContext, project: { readonly path: string } | undefined): string | undefined => review.link ?? (project ? (repoWebUrl(project.path) ?? undefined) : undefined);

/** The review's diff from the reader's clone, as hunks, and the branch's
 *  commit it was read at — what a comment drafted on it is about. The clone
 *  as it is first; fetched only when it does not have the branch yet. */
export const reviewHunks = (found: { readonly review: ReviewContext; readonly project: { readonly path: string } | undefined }) =>
  Effect.gen(function* () {
    if (!found.review.branch) return { error: "this review names no branch" };
    if (!found.project) return { error: "the review's project is not located on this machine (the projects panel) — its code cannot be read here" };
    const clone = { path: found.project.path };
    // the clone as it is first, asking nobody; then fetched, and by its pull request
    let got = yield* readDiff({ ...(found.review.base ? { base: found.review.base } : {}), branch: found.review.branch }, clone, false);
    if (got.kind !== "clone") got = yield* readDiff(found.review, clone, true);
    if (got.kind !== "clone" || !got.commit) return { error: got.why };
    return { hunks: parseDiff(got.diff), commit: got.commit };
  });

/** A pull request as the page shows it: without the branches it joins. */
const shown = ({ branch: _branch, base: _base, merged: _merged, ...pull }: HostPull, viewer: string | undefined) => ({ ...pull, mine: viewer !== undefined && pull.author === viewer });

/** The room's own open reviews of the same project as stack edges: each
 *  names its branch and the base it builds on — only those the reader may
 *  see (a review waiting on another is its author's alone until then). */
const reviewEdges = (found: { readonly room: { readonly tickets: SubscriptionRef.SubscriptionRef<ReadonlyMap<string, Ticket>>; readonly reviews: SubscriptionRef.SubscriptionRef<ReadonlyArray<ReviewContext>> }; readonly ticket: Ticket }) =>
  Effect.gen(function* () {
    const { identity } = yield* IdentityService;
    const all = yield* SubscriptionRef.get(found.room.tickets);
    return (yield* SubscriptionRef.get(found.room.reviews)).flatMap((review): ReadonlyArray<Edge> => {
      const ticket = all.get(review.ticketId);
      if (!ticket || ticket.kind !== "review" || isClosed(ticket) || !review.branch || ticket.project.trim().toLowerCase() !== found.ticket.project.trim().toLowerCase() || !visibleTo(ticket, all, identity.pubkey)) return [];
      return [{ branch: review.branch, base: review.base ?? "main", label: ticket.title ?? ticket.goal, url: `/review/${ticket.id}`, kind: "review" }];
    });
  });

/** The review on its host, for the page: who is signed in, its pull request
 *  and that request's line comments, and the stack its branch sits in (the
 *  host's open pull requests and the room's reviews). Every part that cannot
 *  be read says why in words; the diff never waits on it (a call of its own). */
export const hostView = Effect.fn("ReviewView.host")(function* (ticketId: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { none: `no review ticket ${ticketId} in your rooms`, stack: null } satisfies HostView;
  const branch = found.review.branch;
  const fromRoom = yield* reviewEdges(found);
  const stack = (pulls: ReadonlyArray<HostPull>) =>
    branch ? stackOf(branch, found.review.base ?? "main", [...pulls.map((pull): Edge => ({ branch: pull.branch, base: pull.base, label: pull.title || pull.branch, number: pull.number, url: pull.url, kind: "pull" })), ...fromRoom]) : null;
  const link = hostLink(found.review, found.project);
  if (!link) return { none: "This review names no link to where its code is hosted.", stack: stack([]) } satisfies HostView;
  const host = hostOf(link);
  if (!host) return { none: `collagen has no integration for ${link} yet.`, stack: stack([]) } satisfies HostView;
  const [viewer, named, open] = yield* Effect.all([host.viewer, host.pull(link, branch), host.openPulls(link)], { concurrency: "unbounded" });
  const login = "user" in viewer ? viewer.user.login : undefined;
  const pull = "pull" in named ? named.pull : null;
  // what was said on it: line comments, reviews, the conversation — at once
  const [comments, reviews, conversation] = pull
    ? yield* Effect.all([host.comments(link, pull.number), host.reviews(link, pull.number), host.conversation(link, pull.number)], { concurrency: "unbounded" })
    : [{ inline: [], outdated: [] }, [], []];
  const byTime = <T extends { readonly at: string }>(items: ReadonlyArray<T>) => [...items].sort((a, b) => a.at.localeCompare(b.at));
  return {
    host: host.name,
    viewer: "user" in viewer ? viewer.user : null,
    ...("signIn" in viewer ? { signIn: viewer.signIn } : {}),
    pull: pull ? shown(pull, login) : null,
    ...("none" in named ? { noPull: named.none } : {}),
    comments: comments.inline,
    reviews: byTime(reviews),
    conversation: byTime([...conversation, ...comments.outdated]),
    checkedAt: new Date().toISOString(),
    stack: stack(open),
  } satisfies HostView;
});

/** Only this machine's own browser, by name: the server listens on loopback,
 *  and a page elsewhere that re-points a hostname at 127.0.0.1 (DNS
 *  rebinding) still arrives with its own Host header — refused. */
export const localHost = (host: string | undefined): boolean => host !== undefined && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);

const notFound = (text: string) => HttpServerResponse.text(text, { status: 404 });

/** A ticket id as collagen makes them (a room's too); anything else is not looked up. */
export const ticketIdOk = (id: string | undefined): id is string => id !== undefined && /^[0-9A-Za-z-]{1,64}$/.test(id);

/** Where the built page is (apps/review-web, a Solid app): beside the
 *  bundle in a release (dist/review-web, copied there by the cli build), or
 *  the web app's own dist when collagen runs from source. */
const WEB_ROOTS = [new URL("./review-web/", import.meta.url), new URL("../../../review-web/dist/", import.meta.url)].map((url) => fileURLToPath(url));
export const webRoot = (): string | null => WEB_ROOTS.find((dir) => existsSync(join(dir, "index.html"))) ?? null;

const NOT_BUILT = `The review page is not built. From the collagen repo: pnpm --filter @collagen/review-web build (looked in ${WEB_ROOTS.join(", ")})`;

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export const ReviewRoutes = Layer.mergeAll(
  // the page: one document for every ticket; it reads its id from the url
  HttpRouter.add("GET", "/review/:ticketId", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
      const { ticketId } = yield* HttpRouter.params;
      if (!ticketIdOk(ticketId)) return notFound("no ticket");
      const root = webRoot();
      if (!root) return HttpServerResponse.text(NOT_BUILT, { status: 503 });
      return HttpServerResponse.html(readFileSync(join(root, "index.html"), "utf8"));
    }),
  ),
  // the merge history: the same document, for a room
  HttpRouter.add("GET", "/merges/:roomId", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
      const { roomId } = yield* HttpRouter.params;
      if (!ticketIdOk(roomId)) return notFound("no room");
      const root = webRoot();
      if (!root) return HttpServerResponse.text(NOT_BUILT, { status: 503 });
      return HttpServerResponse.html(readFileSync(join(root, "index.html"), "utf8"));
    }),
  ),
  // its hashed assets, by bare file name only — nothing outside the bundle
  HttpRouter.add("GET", "/review/assets/:file", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
      const { file } = yield* HttpRouter.params;
      const root = webRoot();
      const type = file ? TYPES[extname(file)] : undefined;
      if (!root || !file || !/^[\w.-]+$/.test(file) || !type) return notFound("no such asset");
      const path = join(root, "assets", file);
      if (!existsSync(path)) return notFound("no such asset");
      return HttpServerResponse.uint8Array(readFileSync(path), { contentType: type, headers: { "cache-control": "public, max-age=31536000, immutable" } });
    }),
  ),
);
