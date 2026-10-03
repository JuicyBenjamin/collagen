import { Context, Effect, Stream } from "effect";
import type { AcceptResult, DefinitionResult, HostView, HostWrite, HoverResult, ReviewPageData, SinceResult, TalkView, ToolId, ToolState, Verdict, WholeFileResult } from "../data";

// What the review page's server functions (src/api.ts) ask of the collagen
// instance that serves them. The page declares it; the instance provides it
// (apps/cli, services/ReviewServer) when it loads this bundle — so the
// functions run in the instance's own process, on its own services, and
// nothing here imports the cli. Arguments arrive from the browser: the
// instance checks every one before acting on it.
export class ReviewBackend extends Context.Service<
  ReviewBackend,
  {
    /** the review: its why, its diff laid out under it, where both came from */
    readonly data: (ticketId: string) => Effect.Effect<ReviewPageData | null>;
    /** the review's state as a token — its why's revision, the ticket, the
     *  branch's commit in the clone — current first, then each time it
     *  moves; a reconnect starts again from the current one */
    readonly changes: (ticketId: string) => Stream.Stream<string>;
    /** what the type checker says at a position — of the code at `commit`, the one the page shows */
    readonly hover: (ticketId: string, file: string, line: number, col: number, commit: string) => Effect.Effect<HoverResult>;
    readonly definition: (ticketId: string, file: string, line: number, col: number, commit: string) => Effect.Effect<DefinitionResult>;
    /** a language server's state, now and each time it changes — installing,
     *  ready, failed, a notice it asked to show */
    readonly tool: (tool: ToolId) => Stream.Stream<ToolState>;
    readonly install: (tool: ToolId) => Effect.Effect<ToolState | null>;
    /** a file whole at `commit` — the one the page's diff was read at, never the branch's tip now */
    readonly wholeFile: (ticketId: string, file: string, commit: string) => Effect.Effect<WholeFileResult>;
    /** a file's changes from `from` (where it was viewed) to `to` (the commit the page shows) */
    readonly since: (ticketId: string, file: string, from: string, to: string) => Effect.Effect<SinceResult>;
    /** the review on its host: who is signed in, its pull request, that request's line comments, the stack */
    readonly host: (ticketId: string) => Effect.Effect<HostView>;
    /** a review on the pull request, in the reader's name (through their own gh) */
    readonly review: (ticketId: string, verdict: Verdict, body: string) => Effect.Effect<HostWrite>;
    /** a comment on a line — or a block of lines, from `start` — of the pull request, at the commit the page shows */
    readonly lineComment: (
      ticketId: string,
      file: string,
      line: number,
      side: "LEFT" | "RIGHT",
      body: string,
      commit: string,
      start: { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null,
    ) => Effect.Effect<HostWrite>;
    /** the comments on the review collagen holds: the reader's AI's drafts waiting here, and what the room has said */
    readonly talk: (ticketId: string) => Effect.Effect<TalkView>;
    /** accept drafts (by id, or all: null), said as the reader's — with their words where edited */
    readonly accept: (ticketId: string, ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>>) => Effect.Effect<AcceptResult>;
    /** decline drafts (by id, or all: null); how many went */
    readonly decline: (ticketId: string, ids: ReadonlyArray<string> | null) => Effect.Effect<number>;
  }
>()("review-web/ReviewBackend") {}

let backend: ReviewBackend["Service"] | null = null;

/** The instance hands over its implementation once, before serving. */
export const provideBackend = (impl: ReviewBackend["Service"]): void => {
  backend = impl;
};

const provided = (): ReviewBackend["Service"] => {
  if (!backend) throw new Error("the review page's backend is not provided");
  return backend;
};

/** Run an effect on the backend, for a server function. */
export const run = <A>(f: (b: ReviewBackend["Service"]) => Effect.Effect<A>): Promise<A> => Effect.runPromise(f(provided()));

/** A stream from the backend, as a live server function returns it. */
export const stream = <A>(f: (b: ReviewBackend["Service"]) => Stream.Stream<A>): AsyncIterable<A> => Stream.toAsyncIterable(f(provided()));
