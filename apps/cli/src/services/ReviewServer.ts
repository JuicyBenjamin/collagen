import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, Stream, SubscriptionRef } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { ReviewBackend } from "@collagen/review-web/backend";
import type { CommentSpot } from "@collagen/review-web/data";
import type { Harnesses } from "./Harness";
import { reviewChanges, ReviewPages } from "./ReviewLive";
import { codePathOk, ReviewTypes, toolNamed } from "./ReviewTypes";
import { commitOk, hostView, localHost, projectNameOk, reviewData, reviewHead, sinceViewed, ticketIdOk, treePathOk, webRoot, wholeFile } from "./ReviewView";
import { acceptDrafts, addToReview, dropDrafts, editDraft, repinDraft, sayComment, submitReview, talkView } from "./ReviewTalk";
import { IdentityService } from "./Identity";
import { MergeHistory } from "./MergeHistory";
import { answerQuestion, investigationView } from "./InvestigationView";
import { auditView } from "./AuditView";
import { Jobs } from "./Jobs";
import { closeParent, closeReview, mergeView, parentsView, setMerge, takeReview } from "./ReviewFinish";
import { Outbox } from "./Outbox";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";
import { checkedThemes } from "@collagen/review-web/themeData";
import { settingOf } from "../lib/settings";

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
const verdictOk = (verdict: unknown): verdict is "comment" | "approve" | "request-changes" => verdict === "comment" || verdict === "approve" || verdict === "request-changes";
const bodyOk = (body: unknown): body is string => typeof body === "string" && body.length <= 65_536;
const sideOk = (side: unknown): side is "LEFT" | "RIGHT" => side === "LEFT" || side === "RIGHT";
/** A comment's place, as the page names it — read whole, once: a whole
 *  file, or lines of one; null when it is neither. */
const spotRead = (spot: unknown): CommentSpot | null => {
  if (typeof spot !== "object" || spot === null) return null;
  const place = spot as { subject?: unknown; file?: unknown; line?: unknown; side?: unknown; startLine?: unknown; startSide?: unknown };
  if (typeof place.file !== "string" || !treePathOk(place.file)) return null;
  if (place.subject === "file") return { subject: "file", file: place.file };
  if (place.subject !== undefined || !lineOk(place.line, 0) || !sideOk(place.side)) return null;
  const start = place.startLine === undefined && place.startSide === undefined ? null : { line: place.startLine, side: place.startSide };
  if (!startOk(start, place.line as number, place.side)) return null;
  return { file: place.file, line: place.line as number, side: place.side, ...(start ? { startLine: start.line, startSide: start.side } : {}) };
};
/** A comment the page sends: its place, words and commit, checked. */
const commentOk = (ticketId: unknown, body: unknown, commit: unknown): boolean => ticketIdOk(ticketId as string) && bodyOk(body) && commitOk(commit as string);
/** Drafts named by id — or null, all of them. */
const idsOk = (ids: unknown): ids is ReadonlyArray<string> | null => ids === null || (Array.isArray(ids) && ids.length <= 500 && ids.every((id) => typeof id === "string" && /^[0-9a-f-]{1,64}$/.test(id)));
/** A draft's words as the reader edited them, by its id. */
const editsOk = (edits: unknown): edits is Readonly<Record<string, string>> =>
  typeof edits === "object" && edits !== null && !Array.isArray(edits) && Object.entries(edits).length <= 500 && Object.entries(edits).every(([draftId, body]) => /^[0-9a-f-]{1,64}$/.test(draftId) && bodyOk(body));
/** Where a block of lines starts: none (one line), or a line on a side —
 *  before the last one when both are on the same side, as GitHub asks. */
const startOk = (start: unknown, line: number, side: "LEFT" | "RIGHT"): start is { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null => {
  if (start === null) return true;
  if (typeof start !== "object" || start === undefined) return false;
  const place = start as { line?: unknown; side?: unknown };
  return lineOk(place.line, 0) && sideOk(place.side) && (place.side !== side || (place.line as number) < line);
};

/** The login the page shows signed in: none, or a GitHub login. */
const shownOk = (login: unknown): login is string | null => login === null || (typeof login === "string" && /^[A-Za-z0-9-]{1,39}$/.test(login));

/** A finish from the page: its id, and the pending comments it saw. */
const finishOk = (finish: unknown): finish is { readonly id: string; readonly pending: ReadonlyArray<string> } => {
  if (typeof finish !== "object" || finish === null) return false;
  const { id, pending } = finish as { id?: unknown; pending?: unknown };
  return typeof id === "string" && /^[0-9a-f-]{8,64}$/.test(id) && Array.isArray(pending) && idsOk(pending);
};

/** How many merges the page shows: a whole count. */
const mergesShownOk = (count: unknown): count is number => Number.isInteger(count) && (count as number) >= 1 && (count as number) <= 100_000;

/** The backend, on this instance's services. `definitions`: what each of
 *  collagen's tool definitions weighs, for the audit. */
const backend = (definitions: ReadonlyArray<{ readonly name: string; readonly chars: number }>) => Effect.gen(function* () {
  const context = yield* Effect.context<Rooms | StateStore | ReviewTypes | ReviewPages | IdentityService | Outbox | Harnesses | Jobs>();
  const types = yield* ReviewTypes;
  const history = yield* MergeHistory;
  const store = yield* StateStore;
  const on = <A, E>(effect: Effect.Effect<A, E, Rooms | StateStore | ReviewTypes | ReviewPages | IdentityService | Outbox | Harnesses | Jobs>) => effect.pipe(Effect.provideContext(context), Effect.orDie);
  return {
    head: (ticketId) => (ticketIdOk(ticketId) ? on(reviewHead(ticketId)) : Effect.succeed(null)),
    data: (ticketId) => (ticketIdOk(ticketId) ? on(reviewData(ticketId)) : Effect.succeed(null)),
    changes: (ticketId) => (ticketIdOk(ticketId) ? reviewChanges(ticketId).pipe(Stream.provideContext(context)) : Stream.empty),
    themes: SubscriptionRef.changes(store.state).pipe(
      Stream.map((state) => state.themes ?? null),
      Stream.changesWith((before, after) => JSON.stringify(before) === JSON.stringify(after)),
    ),
    pageSettings: SubscriptionRef.changes(store.state).pipe(
      Stream.map((state) => ({ progressBar: settingOf(state, "progressBar") })),
      Stream.changesWith((before, after) => before.progressBar === after.progressBar),
    ),
    saveThemes: (given) => store.update((state) => ({ ...state, themes: checkedThemes(given) })).pipe(Effect.andThen(store.get), Effect.map((state) => state.themes ?? checkedThemes(null))),
    hover: (ticketId, file, line, col, commit) => (ticketIdOk(ticketId) && codePathOk(file) && lineOk(line, col) && commitOk(commit) ? on(types.hover(ticketId, file, line, col, commit)) : Effect.succeed(bad)),
    definition: (ticketId, file, line, col, commit) => (ticketIdOk(ticketId) && codePathOk(file) && lineOk(line, col) && commitOk(commit) ? on(types.definition(ticketId, file, line, col, commit)) : Effect.succeed(bad)),
    warm: (ticketId, tool, commit) => (ticketIdOk(ticketId) && toolNamed(tool) && commitOk(commit) ? on(types.warm(ticketId, tool, commit)) : Effect.void),
    tool: (tool) => (toolNamed(tool) ? types.watchTool(tool) : Stream.empty),
    install: (tool) => (toolNamed(tool) ? types.startInstall(tool) : Effect.succeed(null)),
    wholeFile: (ticketId, file, commit) => (ticketIdOk(ticketId) && treePathOk(file) && commitOk(commit) ? on(wholeFile(ticketId, file, commit)) : Effect.succeed(bad)),
    since: (ticketId, file, from, to) => (ticketIdOk(ticketId) && treePathOk(file) && commitOk(from) && commitOk(to) ? on(sinceViewed(ticketId, file, from, to)) : Effect.succeed(bad)),
    host: (ticketId) => (ticketIdOk(ticketId) ? on(hostView(ticketId)) : Effect.succeed({ none: "bad request", stack: null })),
    submit: (ticketId, verdict, body, commit, shownAs, seen) =>
      ticketIdOk(ticketId) && verdictOk(verdict) && bodyOk(body) && (commit === null || commitOk(commit)) && shownOk(shownAs) && finishOk(seen)
        ? on(submitReview(ticketId, verdict, body, commit, shownAs, { id: seen.id, pending: seen.pending }))
        : Effect.succeed(bad),
    comment: (ticketId, given, body, commit, shownAs) => {
      const spot = spotRead(given);
      return spot && commentOk(ticketId, body, commit) && shownOk(shownAs) ? on(sayComment(ticketId, spot, commit, body, shownAs)) : Effect.succeed(bad);
    },
    addToReview: (ticketId, given, body, commit) => {
      const spot = spotRead(given);
      return spot && commentOk(ticketId, body, commit) ? on(addToReview(ticketId, spot, commit, body)) : Effect.succeed(bad);
    },
    talk: (ticketId) => (ticketIdOk(ticketId) ? on(talkView(ticketId)) : Effect.succeed({ drafts: [], pending: [], said: [] })),
    accept: (ticketId, ids, edits) => (ticketIdOk(ticketId) && idsOk(ids) && editsOk(edits) ? on(acceptDrafts(ticketId, ids, edits)) : Effect.succeed({ done: 0, failed: [{ id: "", error: "bad request" }] })),
    edit: (ticketId, id, body) => (ticketIdOk(ticketId) && idsOk([id]) && bodyOk(body) ? on(editDraft(ticketId, id, body)) : Effect.succeed({ done: 0, failed: [{ id: "", error: "bad request" }] })),
    repin: (ticketId, id, commit) => (ticketIdOk(ticketId) && idsOk([id]) && commitOk(commit) ? on(repinDraft(ticketId, id, commit)) : Effect.succeed({ done: 0, failed: [{ id: "", error: "bad request" }] })),
    take: (ticketId, findings, failed, comment) =>
      ticketIdOk(ticketId) && bodyOk(findings) && typeof failed === "boolean" && typeof comment === "boolean" ? on(takeReview(ticketId, findings, failed, comment)) : Effect.succeed(bad),
    parents: (ticketId) => (ticketIdOk(ticketId) ? on(parentsView(ticketId)) : Effect.succeed({ tickets: [], ticked: false })),
    closeParent: (ticketId, parentId) => (ticketIdOk(ticketId) && ticketIdOk(parentId) ? on(closeParent(ticketId, parentId)) : Effect.succeed(bad)),
    mergeView: (ticketId) => (ticketIdOk(ticketId) ? on(mergeView(ticketId)) : Effect.succeed(null)),
    setMerge: (ticketId, level) => (ticketIdOk(ticketId) && (level === null || level === "off" || level === "theirs" || level === "mine" || level === "both") ? on(setMerge(ticketId, level)) : Effect.succeed(null)),
    close: (ticketId, outcome) => (ticketIdOk(ticketId) && (outcome === "done" || outcome === "dropped") ? on(closeReview(ticketId, outcome)) : Effect.succeed(bad)),
    merges: (roomId, project, shown, fresh) => (ticketIdOk(roomId) && projectNameOk(project) && mergesShownOk(shown) && typeof fresh === "boolean" ? on(history.page(roomId, project, shown, fresh)) : Effect.succeed(null)),
    answerQuestion: (ticketId, questionId, answer) =>
      ticketIdOk(ticketId) && typeof questionId === "string" && /^[\w-]{1,64}$/.test(questionId) && (answer === "yes" || answer === "no") ? on(answerQuestion(ticketId, questionId, answer)) : Effect.succeed(bad),
    audit: (roomId, days) => auditView(roomId, days, definitions).pipe(Stream.provideContext(context)),
    investigation: (ticketId) => (ticketIdOk(ticketId) ? investigationView(ticketId).pipe(Stream.provideContext(context)) : Stream.make(null)),
    mergeProjects: (roomId) => (ticketIdOk(roomId) ? on(history.projects(roomId)) : Effect.succeed(null)),
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

/** What a page asks its live socket for: a stream opened under its own id,
 *  or one it no longer needs. */
type LiveAsk = { readonly open: string; readonly topic: "changes" | "tool" | "themes" | "settings" | "investigation" | "audit"; readonly subject: string } | { readonly close: string };
/** An audit's subject, "<roomId>:<days>", read once: a room, and 1 to 365 days. */
const auditOf = (impl: ReviewBackend["Service"], subject: string): Stream.Stream<unknown> => {
  const [roomId, days] = subject.split(":");
  const count = Number(days);
  return ticketIdOk(roomId) && Number.isInteger(count) && count >= 1 && count <= 365 ? impl.audit(roomId!, count) : Stream.make(null);
};
const liveIdOk = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,32}$/.test(id);
const liveAskOf = (text: string): LiveAsk | null => {
  try {
    const ask = JSON.parse(text) as Record<string, unknown>;
    if (liveIdOk(ask["close"])) return { close: ask["close"] };
    if (liveIdOk(ask["open"]) && (ask["topic"] === "changes" || ask["topic"] === "tool" || ask["topic"] === "themes" || ask["topic"] === "settings" || ask["topic"] === "investigation" || ask["topic"] === "audit") && typeof ask["subject"] === "string") return { open: ask["open"], topic: ask["topic"], subject: ask["subject"] };
  } catch {
    // not one: ignored
  }
  return null;
};

/** A page's live updates, every one of them on one WebSocket. A browser lets
 *  a page hold only six connections to a host, and a stream held open on
 *  each would take them all with a few tabs; a WebSocket is not counted
 *  against them, so the page's reads and a reload always get through. A
 *  WebSocket is not held to the same-origin rule either: only a page served
 *  from here — its Origin this very host — may open one. */
const liveSocket = (impl: ReviewBackend["Service"]) => (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const host = request.headers["host"];
    if (!localHost(host) || request.headers["origin"] !== `http://${host}`) return HttpServerResponse.text("forbidden", { status: 403 });
    const socket = yield* request.upgrade;
    const write = (yield* socket.writer).write;
    const reader = yield* socket.reader;
    const running = new Map<string, Fiber.Fiber<void>>();
    const stop = (id: string) => {
      const fiber = running.get(id);
      running.delete(id);
      return fiber ? Fiber.interrupt(fiber) : Effect.void;
    };
    // each message read, until the page goes
    yield* Effect.gen(function* () {
      for (;;) {
        for (const message of yield* reader.pull) {
          const ask = liveAskOf(typeof message === "string" ? message : new TextDecoder().decode(message));
          if (ask === null) continue;
          if ("close" in ask) {
            yield* stop(ask.close);
            continue;
          }
          yield* stop(ask.open);
          const values: Stream.Stream<unknown> =
            ask.topic === "changes" ? impl.changes(ask.subject) : ask.topic === "investigation" ? impl.investigation(ask.subject) : ask.topic === "audit" ? auditOf(impl, ask.subject) : ask.topic === "themes" ? impl.themes : ask.topic === "settings" ? impl.pageSettings : impl.tool(ask.subject as Parameters<typeof impl.tool>[0]);
          const fiber = yield* values.pipe(
            Stream.runForEach((value) => write(JSON.stringify({ id: ask.open, value }))),
            // its stream ended: the page is told, to open it again
            Effect.andThen(write(JSON.stringify({ id: ask.open, end: true }))),
            Effect.ignore,
            Effect.forkChild,
          );
          running.set(ask.open, fiber);
        }
      }
    }).pipe(Effect.ignore);
    yield* Effect.forEach([...running.keys()], stop, { discard: true });
    return HttpServerResponse.empty();
  }).pipe(
    Effect.scoped,
    Effect.catch(() => Effect.succeed(HttpServerResponse.text("bad request", { status: 400 }))),
  );

export const ReviewServerRoutes = (definitions: ReadonlyArray<{ readonly name: string; readonly chars: number }>) => Layer.unwrap(
  Effect.gen(function* () {
    const impl = yield* backend(definitions);
    const load = bundle(impl);
    // the wildcard takes the endpoint itself too (POSTed calls) and what
    // is under it (a GET's /<id>, a live call's /live/<id>)
    return Layer.mergeAll(HttpRouter.add("*", "/review/_server/*", handle(load)), HttpRouter.add("GET", "/review/_live", liveSocket(impl)));
  }),
);
