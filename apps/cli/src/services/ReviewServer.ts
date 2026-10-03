import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { ReviewBackend } from "@collagen/review-web/backend";
import { reviewChanges, ReviewPages } from "./ReviewLive";
import { codePathOk, ReviewTypes, toolNamed } from "./ReviewTypes";
import { commitOk, localHost, reviewData, sinceViewed, ticketIdOk, treePathOk, webRoot, wholeFile } from "./ReviewView";
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

/** The backend, on this instance's services. */
const backend = Effect.gen(function* () {
  const ctx = yield* Effect.context<Rooms | StateStore | ReviewTypes | ReviewPages>();
  const types = yield* ReviewTypes;
  const on = <A, E>(e: Effect.Effect<A, E, Rooms | StateStore | ReviewTypes | ReviewPages>) => e.pipe(Effect.provideContext(ctx), Effect.orDie);
  return {
    data: (ticketId) => (ticketIdOk(ticketId) ? on(reviewData(ticketId)) : Effect.succeed(null)),
    changes: (ticketId) => (ticketIdOk(ticketId) ? reviewChanges(ticketId).pipe(Stream.provideContext(ctx)) : Stream.empty),
    hover: (ticketId, file, line, col) => (ticketIdOk(ticketId) && codePathOk(file) && lineOk(line, col) ? on(types.hover(ticketId, file, line, col)) : Effect.succeed(bad)),
    definition: (ticketId, file, line, col) => (ticketIdOk(ticketId) && codePathOk(file) && lineOk(line, col) ? on(types.definition(ticketId, file, line, col)) : Effect.succeed(bad)),
    tool: (tool) => (toolNamed(tool) ? types.watchTool(tool) : Stream.empty),
    install: (tool) => (toolNamed(tool) ? types.startInstall(tool) : Effect.succeed(null)),
    wholeFile: (ticketId, file) => (ticketIdOk(ticketId) && treePathOk(file) ? on(wholeFile(ticketId, file)) : Effect.succeed(bad)),
    since: (ticketId, file, from) => (ticketIdOk(ticketId) && treePathOk(file) && commitOk(from) ? on(sinceViewed(ticketId, file, from)) : Effect.succeed(bad)),
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
