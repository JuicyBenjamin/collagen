import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer, SubscriptionRef } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { roomProjects, type ReviewContext, type Ticket } from "@collagen/p2p";
import { gitDir } from "../lib/gitInfo";
import type { ReviewPageData } from "@collagen/review-web/data";
import { groupByWhy, parseDiff } from "../lib/reviewView";
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

/** Where code lives when there is no clone to read: a host adapter knows how
 *  to get a compare diff from a link, and what to link back to. The clone is
 *  the source of truth and never calls one; GitHub is the first. */
export interface HostAdapter {
  readonly name: string;
  readonly matches: (link: string) => boolean;
  readonly compare: (link: string, base: string, branch: string) => Effect.Effect<string | null>;
  readonly links: (link: string, base: string | undefined, branch: string | undefined) => ReadonlyArray<{ readonly label: string; readonly url: string }>;
}

const githubRepo = (link: string): { owner: string; repo: string } | null => {
  const m = link.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
  return m ? { owner: m[1]!, repo: m[2]!.replace(/\.git$/, "") } : null;
};

/** GitHub, through the person's own `gh` login. */
export const github: HostAdapter = {
  name: "GitHub",
  matches: (link) => githubRepo(link) !== null,
  compare: (link, base, branch) => {
    const r = githubRepo(link);
    if (!r) return Effect.succeed(null);
    return run("gh", ["api", "-H", "Accept: application/vnd.github.diff", `repos/${r.owner}/${r.repo}/compare/${base}...${branch}`], undefined, 20_000);
  },
  links: (link, base, branch) => {
    const r = githubRepo(link);
    if (!r) return [];
    const pr = /\/pull\/\d+/.test(link);
    return [
      { label: pr ? "pull request" : "on GitHub", url: link },
      ...(pr ? [{ label: "checks", url: `${link.replace(/\/(files|commits|checks)\/?$/, "")}/checks` }] : []),
      ...(base && branch ? [{ label: "compare", url: `https://github.com/${r.owner}/${r.repo}/compare/${base}...${branch}` }] : []),
    ];
  },
};

const HOSTS: ReadonlyArray<HostAdapter> = [github];


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
const fromClone = (path: string, base: string, branch: string) =>
  Effect.gen(function* () {
    if (!gitDir(path)) return { diff: null, why: `${path} is not a git repository` };
    // best effort: offline, or a remote that needs a password, still has whatever is local
    yield* run("git", ["fetch", "--quiet", "--no-tags", "origin"], path, 20_000);
    const b = yield* firstRef(path, [branch, `origin/${branch}`]);
    const a = yield* firstRef(path, [base, `origin/${base}`]);
    if (!b) return { diff: null, why: `the branch ${branch} is not in your clone at ${path}, nor on its origin` };
    if (!a) return { diff: null, why: `the base ${base} is not in your clone at ${path}, nor on its origin` };
    const diff = yield* run("git", ["diff", "--no-color", "--no-ext-diff", "-U3", `${a}...${b}`], path, 30_000);
    return diff === null ? { diff: null, why: `git diff ${a}...${b} failed in ${path}` } : { diff, why: `${a}...${b} from your clone at ${path}` };
  });

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
    const host = review.link ? HOSTS.find((x) => x.matches(review.link!)) : undefined;
    let source: ReviewPageData["source"] = { kind: "none", detail: "" };
    let diff: string | null = null;
    if (!branch) source = { kind: "none", detail: "this review names no branch — the decisions are listed with where they landed" };
    else if (project) {
      const got = yield* fromClone(project.path, base, branch);
      diff = got.diff;
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
    return {
      ticket: { id: ticket.id, goal: ticket.goal, kind: ticket.kind, project: ticket.project },
      review: { summary: review.summary, branch: review.branch, base: review.base, link: review.link, authorName: review.authorName, decisions: review.decisions, forks: review.forks, ts: review.ts },
      source,
      grouped: diff === null ? null : groupByWhy(review, parseDiff(diff)),
      links: host && review.link ? host.links(review.link, base, branch) : review.link ? [{ label: "link", url: review.link }] : [],
    } satisfies ReviewPageData;
  }
  return null;
});

/** Only this machine's own browser, by name: the server listens on loopback,
 *  and a page elsewhere that re-points a hostname at 127.0.0.1 (DNS
 *  rebinding) still arrives with its own Host header — refused. */
const localHost = (host: string | undefined): boolean => host !== undefined && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);

const notFound = (text: string) => HttpServerResponse.text(text, { status: 404 });

/** A ticket id as collagen makes them; anything else is not looked up. */
const ticketIdOk = (id: string | undefined): id is string => id !== undefined && /^[0-9A-Za-z-]{1,64}$/.test(id);

/** Where the built page is (apps/review-web, a Solid app): beside the
 *  bundle in a release (dist/review-web, copied there by the cli build), or
 *  the web app's own dist when collagen runs from source. */
const WEB_ROOTS = [new URL("./review-web/", import.meta.url), new URL("../../../review-web/dist/", import.meta.url)].map((u) => fileURLToPath(u));
const webRoot = (): string | null => WEB_ROOTS.find((dir) => existsSync(join(dir, "index.html"))) ?? null;

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
  HttpRouter.add("GET", "/review/:ticketId/data", (request) =>
    Effect.gen(function* () {
      if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
      const { ticketId } = yield* HttpRouter.params;
      const data = ticketIdOk(ticketId) ? yield* reviewData(ticketId) : null;
      if (!data) return notFound(`no review ticket ${ticketId ?? ""} in your rooms`);
      return HttpServerResponse.jsonUnsafe(data);
    }),
  ),
);
