import { Context, Effect, Stream } from "effect";
import type { DefinitionResult, DraftsResult, Finish, HostView, HostWrite, HoverResult, MergeHistory, MergesShown, ReviewPageData, ReviewPageHead, SinceResult, SubmitResult, TalkView, ToolId, ToolState, Verdict, WholeFileResult } from "../data";

/** Where a block of lines starts, or null for one line. */
type LineStart = { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null;

// What the review page's server functions (src/api.ts) ask of the collagen
// instance that serves them. The page declares it; the instance provides it
// (apps/cli, services/ReviewServer) when it loads this bundle — so the
// functions run in the instance's own process, on its own services, and
// nothing here imports the cli. Arguments arrive from the browser: the
// instance checks every one before acting on it.
export class ReviewBackend extends Context.Service<
  ReviewBackend,
  {
    /** the review's why, ticket and links alone — from the room, no diff read */
    readonly head: (ticketId: string) => Effect.Effect<ReviewPageHead | null>;
    /** the review: its why, its diff laid out under it, where both came from */
    readonly data: (ticketId: string) => Effect.Effect<ReviewPageData | null>;
    /** the review's state as a token — its why's revision, the ticket, the
     *  branch's commit in the clone — current first, then each time it
     *  moves; a reconnect starts again from the current one */
    readonly changes: (ticketId: string) => Stream.Stream<string>;
    /** what the type checker says at a position — of the code at `commit`, the one the page shows */
    readonly hover: (ticketId: string, file: string, line: number, col: number, commit: string) => Effect.Effect<HoverResult>;
    readonly definition: (ticketId: string, file: string, line: number, col: number, commit: string) => Effect.Effect<DefinitionResult>;
    /** start the review's server for a language at `commit`, so it reads the project before the first hover */
    readonly warm: (ticketId: string, tool: ToolId, commit: string) => Effect.Effect<void>;
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
    /** finish the reader's review: its pending comments said — on the pull request as one review with
     *  their verdict and words, and in the room; `commit`: the one the page shows; `shownAs`: the
     *  login the page shows signed in — a write under anyone else is refused; `seen`: this finish's
     *  own id and the pending comments the page showed — done once, and refused if the review changed */
    readonly submit: (ticketId: string, verdict: Verdict, body: string, commit: string | null, shownAs: string | null, seen: Finish) => Effect.Effect<SubmitResult>;
    /** a single comment, said at once — on a line, or a block of lines from `start`, at the commit the page shows */
    readonly lineComment: (ticketId: string, file: string, line: number, side: "LEFT" | "RIGHT", body: string, commit: string, start: LineStart, shownAs: string | null) => Effect.Effect<HostWrite>;
    /** a comment into the reader's review: pending, said when they finish it */
    readonly addToReview: (ticketId: string, file: string, line: number, side: "LEFT" | "RIGHT", body: string, commit: string, start: LineStart) => Effect.Effect<HostWrite>;
    /** the comments on the review collagen holds: the AI's drafts and the pending review here, and what the room has said */
    readonly talk: (ticketId: string) => Effect.Effect<TalkView>;
    /** accept AI drafts (by id, or all: null) into the review — with the reader's words where edited */
    readonly accept: (ticketId: string, ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>>) => Effect.Effect<DraftsResult>;
    /** new words for a draft or a pending comment */
    readonly edit: (ticketId: string, id: string, body: string) => Effect.Effect<DraftsResult>;
    /** drop drafts or pending comments (by id; or, with null, all of a kind); how many went */
    readonly drop: (ticketId: string, ids: ReadonlyArray<string> | null, kind: "ai" | "pending") => Effect.Effect<number>;
    /** a comment not said yet, confirmed where it sits at `commit` — the one the page shows now */
    readonly repin: (ticketId: string, id: string, commit: string) => Effect.Effect<DraftsResult>;
    /** what was merged into a room's projects, with the tickets each came from; null for a room not here */
    /** the reader's take on a review, said in the room as theirs; `failed` rejects it */
    readonly take: (ticketId: string, findings: string, failed: boolean) => Effect.Effect<HostWrite>;
    /** a review the reader filed, closed: accepted as done, or dropped */
    readonly close: (ticketId: string, outcome: "done" | "dropped") => Effect.Effect<HostWrite>;
    readonly merges: (roomId: string, shown: MergesShown, fresh: boolean) => Effect.Effect<MergeHistory | null>;
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
export const run = <A>(operation: (service: ReviewBackend["Service"]) => Effect.Effect<A>): Promise<A> => Effect.runPromise(operation(provided()));

/** A stream from the backend, as a live server function returns it. */
export const stream = <A>(operation: (service: ReviewBackend["Service"]) => Stream.Stream<A>): AsyncIterable<A> => Stream.toAsyncIterable(operation(provided()));
