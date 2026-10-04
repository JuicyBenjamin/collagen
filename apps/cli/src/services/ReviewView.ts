import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer, SubscriptionRef } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { isClosed, roomProjects, visibleTo, type ReviewContext, type Ticket } from "@collagen/p2p";
import { gitDir, repoWebUrl } from "../lib/gitInfo";
import type { HostView, HostWrite, ReviewPageData, SinceResult, Verdict, WholeFileResult } from "@collagen/review-web/data";
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

/** Run a command, its stdout or null — never a failure: no git, no clone, no
 *  network all degrade the page, they do not break it. */
const run = (cmd: string, args: ReadonlyArray<string>, cwd: string | undefined, timeoutMs: number): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    const child = execFile(cmd, [...args], { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err, stdout) =>
      resume(Effect.succeed(err ? null : stdout)),
    );
    return Effect.sync(() => child.kill());
  });




/** The first of `refs` the repo knows as a commit. */
const firstRef = (cwd: string, refs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const ref of refs) {
      const ok = yield* run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd, 5_000);
      if (ok !== null && ok.trim().length > 0) return ref;
    }
    return null;
  });

/** The diff of base...branch from the clone at `path`: fetch first (the
 *  reviewer may not have the branch yet), then the refs as they are, local
 *  or origin's. Null with the reason when it cannot. */
const fromClone = (path: string, base: string, branch: string, fetch = true) =>
  Effect.gen(function* () {
    if (!gitDir(path)) return { diff: null, why: `${path} is not a git repository` };
    // best effort: offline, or a remote that needs a password, still has whatever is local
    if (fetch) yield* run("git", ["fetch", "--quiet", "--no-tags", "origin"], path, 20_000);
    const b = yield* firstRef(path, [branch, `origin/${branch}`]);
    const a = yield* firstRef(path, [base, `origin/${base}`]);
    if (!b) return { diff: null, why: `the branch ${branch} is not in your clone at ${path}, nor on its origin` };
    if (!a) return { diff: null, why: `the base ${base} is not in your clone at ${path}, nor on its origin` };
    const diff = yield* run("git", ["diff", "--no-color", "--no-ext-diff", "-U3", `${a}...${b}`], path, 30_000);
    const commit = (yield* run("git", ["rev-parse", `${b}^{commit}`], path, 5_000))?.trim() || undefined;
    return diff === null ? { diff: null, why: `git diff ${a}...${b} failed in ${path}` } : { diff, why: `${a}...${b} from your clone at ${path}`, commit };
  });

/** The code a review's branch holds, for reading it as code (type hints,
 *  definitions): the reader's clone of the project and the branch's commit
 *  in it — local first, then origin's, fetched by the page's data request.
 *  Or why there is none, in words for the page. */
export const reviewTree = Effect.fn("ReviewView.tree")(function* (ticketId: string) {
  const rooms = yield* Rooms;
  const store = yield* StateStore;
  for (const h of yield* SubscriptionRef.get(rooms.handles)) {
    const ticket = (yield* SubscriptionRef.get(h.room.tickets)).get(ticketId);
    if (!ticket) continue;
    const review = (yield* SubscriptionRef.get(h.room.reviews)).find((r) => r.ticketId === ticketId);
    if (!review?.branch) return "this review names no branch";
    const project = roomProjects(yield* store.get, h.id).find((p) => p.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
    if (!project || !gitDir(project.path)) return `no clone of "${ticket.project}" on this machine to read the code from`;
    const ref = yield* firstRef(project.path, [review.branch, `origin/${review.branch}`]);
    const commit = ref ? (yield* run("git", ["rev-parse", `${ref}^{commit}`], project.path, 5_000))?.trim() : undefined;
    if (!commit) return `the branch ${review.branch} is not in your clone`;
    return { projectPath: project.path, commit, ref: ref! };
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

/** Is `commit` a commit the clone at `path` has? */
export const commitIn = (path: string, commit: string) => run("git", ["cat-file", "-e", `${commit}^{commit}`], path, 5_000).pipe(Effect.map((ok) => ok !== null));

/** A commit as the page names it: a full or abbreviated hash, nothing else. */
export const commitOk = (c: string | undefined): c is string => c !== undefined && /^[0-9a-f]{7,40}$/.test(c);

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
  return { hunks: parseDiff(diff).map((h) => ({ ...h, id: `since:${h.id}` })) } satisfies SinceResult;
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

export const commitOf = (path: string, ref: string) => run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], path, 5_000).pipe(Effect.map((s) => s?.trim() || null));

export const reviewData = Effect.fn("ReviewView.data")(function* (ticketId: string) {
  const rooms = yield* Rooms;
  const store = yield* StateStore;
  for (const h of yield* SubscriptionRef.get(rooms.handles)) {
    const ticket = (yield* SubscriptionRef.get(h.room.tickets)).get(ticketId);
    if (!ticket) continue;
    const review = (yield* SubscriptionRef.get(h.room.reviews)).find((r) => r.ticketId === ticketId);
    if (!review) return null;
    const base = review.base ?? "main";
    const branch = review.branch;
    const project = roomProjects(yield* store.get, h.id).find((p) => p.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
    const host = review.link ? hostOf(review.link) : undefined;
    let source: ReviewPageData["source"] = { kind: "none", detail: "" };
    let diff: string | null = null;
    let commit: string | undefined;
    if (!branch) source = { kind: "none", detail: "this review names no branch — the decisions are listed with where they landed" };
    else if (project) {
      const got = yield* fromClone(project.path, base, branch);
      diff = got.diff;
      commit = "commit" in got ? got.commit : undefined;
      source = { kind: diff === null ? "none" : "clone", detail: got.why };
    } else source = { kind: "none", detail: `you have not located "${ticket.project}" on this machine (the projects panel)` };
    // no clone to read: the host, when the link names one and its tool is logged in
    if (diff === null && branch && host && review.link) {
      const hosted = yield* host.compare(review.link, base, branch);
      if (hosted !== null) {
        diff = hosted;
        source = { kind: "host", detail: `${base}...${branch} from ${host.name} (no clone: ${source.detail})` };
      }
    }
    // which changed files import which, as the branch has them in the clone:
    // what groups the code no unit names, and orders the units
    const hunks = diff === null ? [] : parseDiff(diff);
    let imports: Imports = new Map();
    if (project && commit && hunks.length > 0) {
      const files = [...new Set(hunks.map((h) => h.file))];
      const texts = new Map<string, string | null>();
      for (const f of files) texts.set(f, yield* run("git", ["show", `${commit}:${f}`], project.path, 5_000));
      imports = importsAmong(files, (f) => texts.get(f) ?? null);
    }
    return {
      ticket: { id: ticket.id, ...(ticket.title ? { title: ticket.title } : {}), goal: ticket.goal, kind: ticket.kind, project: ticket.project },
      review: { summary: review.summary, branch: review.branch, base: review.base, link: review.link, authorName: review.authorName, decisions: review.decisions, forks: review.forks, ts: review.ts },
      source,
      ...(source.kind === "clone" && commit ? { commit } : {}),
      grouped: diff === null ? null : groupByUnit(review, hunks, imports),
      links: host && review.link ? host.links(review.link, base, branch) : review.link ? [{ label: "link", url: review.link }] : [],
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
    for (const h of yield* SubscriptionRef.get(rooms.handles)) {
      const ticket = (yield* SubscriptionRef.get(h.room.tickets)).get(ticketId);
      if (!ticket) continue;
      const review = (yield* SubscriptionRef.get(h.room.reviews)).find((r) => r.ticketId === ticketId);
      if (!review) return null;
      const project = roomProjects(yield* store.get, h.id).find((p) => p.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
      return { room: h.room, ticket, review, project };
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
    const base = found.review.base ?? "main";
    let got = yield* fromClone(found.project.path, base, found.review.branch, false);
    if (got.diff === null) got = yield* fromClone(found.project.path, base, found.review.branch, true);
    if (got.diff === null || !("commit" in got) || !got.commit) return { error: got.why };
    return { hunks: parseDiff(got.diff), commit: got.commit };
  });

/** A pull request as the page shows it: without the branches it joins. */
const shown = ({ branch: _branch, base: _base, ...pull }: HostPull, viewer: string | undefined) => ({ ...pull, mine: viewer !== undefined && pull.author === viewer });

/** The room's own open reviews of the same project as stack edges: each
 *  names its branch and the base it builds on — only those the reader may
 *  see (a review waiting on another is its author's alone until then). */
const reviewEdges = (found: { readonly room: { readonly tickets: SubscriptionRef.SubscriptionRef<ReadonlyMap<string, Ticket>>; readonly reviews: SubscriptionRef.SubscriptionRef<ReadonlyArray<ReviewContext>> }; readonly ticket: Ticket }) =>
  Effect.gen(function* () {
    const { identity } = yield* IdentityService;
    const all = yield* SubscriptionRef.get(found.room.tickets);
    return (yield* SubscriptionRef.get(found.room.reviews)).flatMap((r): ReadonlyArray<Edge> => {
      const t = all.get(r.ticketId);
      if (!t || t.kind !== "review" || isClosed(t) || !r.branch || t.project.trim().toLowerCase() !== found.ticket.project.trim().toLowerCase() || !visibleTo(t, all, identity.pubkey)) return [];
      return [{ branch: r.branch, base: r.base ?? "main", label: t.title ?? t.goal, url: `/review/${t.id}`, kind: "review" }];
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
    branch ? stackOf(branch, found.review.base ?? "main", [...pulls.map((p): Edge => ({ branch: p.branch, base: p.base, label: p.title || p.branch, number: p.number, url: p.url, kind: "pull" })), ...fromRoom]) : null;
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
  const byTime = <T extends { readonly at: string }>(xs: ReadonlyArray<T>) => [...xs].sort((a, b) => a.at.localeCompare(b.at));
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

/** A ticket id as collagen makes them; anything else is not looked up. */
export const ticketIdOk = (id: string | undefined): id is string => id !== undefined && /^[0-9A-Za-z-]{1,64}$/.test(id);

/** Where the built page is (apps/review-web, a Solid app): beside the
 *  bundle in a release (dist/review-web, copied there by the cli build), or
 *  the web app's own dist when collagen runs from source. */
const WEB_ROOTS = [new URL("./review-web/", import.meta.url), new URL("../../../review-web/dist/", import.meta.url)].map((u) => fileURLToPath(u));
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
