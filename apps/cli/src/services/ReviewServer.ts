import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { ReviewBackend } from "@collagen/review-web/backend";
import { reviewChanges, ReviewPages } from "./ReviewLive";
import { codePathOk, ReviewTypes, toolNamed } from "./ReviewTypes";
import { commitOk, hostView, localHost, reviewData, sinceViewed, ticketIdOk, treePathOk, webRoot, wholeFile } from "./ReviewView";
import { acceptDrafts, addToReview, dropDrafts, editDraft, sayComment, submitReview, talkView } from "./ReviewTalk";
import { IdentityService } from "./Identity";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

// The review page talks to this instance through Solid's server functions
// (apps/review-web src/api.ts) — no routes of its own. The page's build
// emits a server bundle (dist/server/entry.js): Solid's handler, the
// functions it can call, and a hook to provide what they run on. Here the
// instance loads it, provides that backend from its own services, and
// mounts the handler under /review/_server. Everything a function is asked
// arrives from a browser, so every argument is checked here before anything
// is done with it; the handler itself refuses cross-origin calls, and only
// this machine's own browser reaches it at all (localHost).

interface ServerEntry {
  readonly handleServerFunctionRequest: (request: Request) => Promise<Response>;
  readonly provideBackend: (impl: ReviewBackend["Service"]) => void;
}

const lineOk = (line: unknown, col: unknown): boolean => Number.isInteger(line) && (line as number) > 0 && Number.isInteger(col) && (col as number) >= 0;
const bad = { error: "bad request" } as const;
/** What a review can say, and how long anything written to a host may be (GitHub's own limit). */
const verdictOk = (v: unknown): v is "comment" | "approve" | "request-changes" => v === "comment" || v === "approve" || v === "request-changes";
const bodyOk = (b: unknown): b is string => typeof b === "string" && b.length <= 65_536;
const sideOk = (s: unknown): s is "LEFT" | "RIGHT" => s === "LEFT" || s === "RIGHT";
/** A comment's place, as the page names it — checked whole. */
const spotOk = (ticketId: unknown, file: unknown, line: unknown, side: unknown, body: unknown, commit: unknown, start: unknown): boolean =>
  ticketIdOk(ticketId as string) && treePathOk(file as string) && lineOk(line, 0) && sideOk(side) && bodyOk(body) && commitOk(commit as string) && startOk(start, line as number, side as "LEFT" | "RIGHT");
const spot = (file: string, line: number, side: "LEFT" | "RIGHT", start: { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null) => ({ file, line, side, ...(start ? { startLine: start.line, startSide: start.side } : {}) });
/** Drafts named by id — or null, all of them. */
const idsOk = (ids: unknown): ids is ReadonlyArray<string> | null => ids === null || (Array.isArray(ids) && ids.length <= 500 && ids.every((i) => typeof i === "string" && /^[0-9a-f-]{1,64}$/.test(i)));
/** A draft's words as the reader edited them, by its id. */
const editsOk = (e: unknown): e is Readonly<Record<string, string>> =>
  typeof e === "object" && e !== null && !Array.isArray(e) && Object.entries(e).length <= 500 && Object.entries(e).every(([k, v]) => /^[0-9a-f-]{1,64}$/.test(k) && bodyOk(v));
/** Where a block of lines starts: none (one line), or a line on a side —
 *  before the last one when both are on the same side, as GitHub asks. */
const startOk = (start: unknown, line: number, side: "LEFT" | "RIGHT"): start is { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null => {
  if (start === null) return true;
  if (typeof start !== "object" || start === undefined) return false;
  const s = start as { line?: unknown; side?: unknown };
  return lineOk(s.line, 0) && sideOk(s.side) && (s.side !== side || (s.line as number) < line);
};

/** The backend, on this instance's services. */
const backend = Effect.gen(function* () {
  const ctx = yield* Effect.context<Rooms | StateStore | ReviewTypes | ReviewPages | IdentityService>();
  const types = yield* ReviewTypes;
  const on = <A, E>(e: Effect.Effect<A, E, Rooms | StateStore | ReviewTypes | ReviewPages | IdentityService>) => e.pipe(Effect.provideContext(ctx), Effect.orDie);
  return {
    data: (ticketId) => (ticketIdOk(ticketId) ? on(reviewData(ticketId)) : Effect.succeed(null)),
    changes: (ticketId) => (ticketIdOk(ticketId) ? reviewChanges(ticketId).pipe(Stream.provideContext(ctx)) : Stream.empty),
    hover: (ticketId, file, line, col, commit) => (ticketIdOk(ticketId) && codePathOk(file) && lineOk(line, col) && commitOk(commit) ? on(types.hover(ticketId, file, line, col, commit)) : Effect.succeed(bad)),
    definition: (ticketId, file, line, col, commit) => (ticketIdOk(ticketId) && codePathOk(file) && lineOk(line, col) && commitOk(commit) ? on(types.definition(ticketId, file, line, col, commit)) : Effect.succeed(bad)),
    tool: (tool) => (toolNamed(tool) ? types.watchTool(tool) : Stream.empty),
    install: (tool) => (toolNamed(tool) ? types.startInstall(tool) : Effect.succeed(null)),
    wholeFile: (ticketId, file, commit) => (ticketIdOk(ticketId) && treePathOk(file) && commitOk(commit) ? on(wholeFile(ticketId, file, commit)) : Effect.succeed(bad)),
    since: (ticketId, file, from, to) => (ticketIdOk(ticketId) && treePathOk(file) && commitOk(from) && commitOk(to) ? on(sinceViewed(ticketId, file, from, to)) : Effect.succeed(bad)),
    host: (ticketId) => (ticketIdOk(ticketId) ? on(hostView(ticketId)) : Effect.succeed({ none: "bad request", stack: null })),
    submit: (ticketId, verdict, body, commit) =>
      ticketIdOk(ticketId) && verdictOk(verdict) && bodyOk(body) && (commit === null || commitOk(commit)) ? on(submitReview(ticketId, verdict, body, commit)) : Effect.succeed(bad),
    lineComment: (ticketId, file, line, side, body, commit, start) =>
      spotOk(ticketId, file, line, side, body, commit, start) ? on(sayComment(ticketId, spot(file, line, side, start), commit, body)) : Effect.succeed(bad),
    addToReview: (ticketId, file, line, side, body, commit, start) =>
      spotOk(ticketId, file, line, side, body, commit, start) ? on(addToReview(ticketId, spot(file, line, side, start), commit, body)) : Effect.succeed(bad),
    talk: (ticketId) => (ticketIdOk(ticketId) ? on(talkView(ticketId)) : Effect.succeed({ drafts: [], pending: [], said: [] })),
    accept: (ticketId, ids, edits) => (ticketIdOk(ticketId) && idsOk(ids) && editsOk(edits) ? on(acceptDrafts(ticketId, ids, edits)) : Effect.succeed({ done: 0, failed: [{ id: "", error: "bad request" }] })),
    edit: (ticketId, id, body) => (ticketIdOk(ticketId) && idsOk([id]) && bodyOk(body) ? on(editDraft(ticketId, id, body)) : Effect.succeed({ done: 0, failed: [{ id: "", error: "bad request" }] })),
    drop: (ticketId, ids, kind) => (ticketIdOk(ticketId) && idsOk(ids) && (kind === "ai" || kind === "pending") ? on(dropDrafts(ticketId, ids, kind)) : Effect.succeed(0)),
  } satisfies ReviewBackend["Service"];
});

/** The page's server bundle, given its backend: loaded when a call first
 *  needs it, and again when the page is rebuilt (its file's time moved) —
 *  so a build while collagen runs, or collagen started before one, never
 *  leaves the page without its functions. Null while it is not built. */
const bundle = (impl: ReviewBackend["Service"]) => {
  let current: { readonly at: number; readonly entry: ServerEntry } | null = null;
  return Effect.gen(function* () {
    const root = webRoot();
    const path = root ? join(root, "server", "entry.js") : null;
    if (!path || !existsSync(path)) return null;
    const at = statSync(path).mtimeMs;
    if (current?.at !== at) {
      const entry = yield* Effect.promise(() => import(`${pathToFileURL(path).href}?at=${at}`) as Promise<ServerEntry>);
      entry.provideBackend(impl);
      current = { at, entry };
    }
    return current.entry;
  });
};

const handle = (load: Effect.Effect<ServerEntry | null>) => (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    if (!localHost(request.headers["host"])) return HttpServerResponse.text("forbidden", { status: 403 });
    const entry = yield* load;
    if (!entry) return HttpServerResponse.text("the review page is not built: pnpm --filter @collagen/review-web build", { status: 503 });
    const web = yield* HttpServerRequest.toWeb(request);
    return HttpServerResponse.fromWeb(yield* Effect.promise(() => entry.handleServerFunctionRequest(web)));
  }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.text("bad request", { status: 400 }))));

export const ReviewServerRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const load = bundle(yield* backend);
    // the wildcard takes the endpoint itself too (POSTed calls) and what
    // is under it (a GET's /<id>, a live call's /live/<id>)
    return HttpRouter.add("*", "/review/_server/*", handle(load));
  }),
);
