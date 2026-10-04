// The contract between the collagen instance and the review page: what
// the page's server functions (src/api.ts) answer. It lives with the page,
// and the cli imports it (apps/cli/src/lib/reviewView, services/ReviewView), so the two
// sides cannot drift. Plain types, no runtime: nothing here is bundled into
// the cli.

export interface DiffLine {
  readonly kind: "+" | "-" | " ";
  readonly text: string;
  /** line number in the old file (context and removed lines) */
  readonly old?: number;
  /** line number in the new file (context and added lines) */
  readonly new?: number;
}

export interface Hunk {
  /** stable within one diff: `<file>#<n>` */
  readonly id: string;
  /** the file's new path (old path for a deletion) */
  readonly file: string;
  readonly header: string;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: ReadonlyArray<DiffLine>;
}

/** What an old ticket's decision, filed before titles, shows in its place. */
export const NO_TITLE = "Old ticket — no title";

/** A decision behind the change, as the review's why records it. */
export interface Decision {
  readonly id: string;
  /** Its headline, a few words; absent only on an old ticket's. */
  readonly title?: string;
  /** What was done, in a line — beneath the title. */
  readonly what: string;
  readonly userWhy?: string;
  readonly agentWhy?: string;
  readonly where: ReadonlyArray<string>;
  /** the skills and agent files that told the agent to do it this way */
  readonly guidedBy?: ReadonlyArray<string>;
}

/** A fork in the road: chosen over what, why, whose call. */
export interface Fork {
  readonly id: string;
  readonly at: string;
  readonly chose: string;
  readonly instead: string;
  readonly why: string;
  readonly by?: "user" | "agent";
}

/** A unit of the change: code that together achieves one thing, each hunk
 *  of the diff in exactly one unit, titled by what it achieves. Named by the
 *  author's agent; where it named none, a decision's code is its own unit,
 *  titled by the decision; what no decision covers is "Not explained". */
export interface Unit {
  readonly id: string;
  /** what it achieves — never a file name */
  readonly title: string;
  /** the line beneath the title */
  readonly what: string;
  readonly by: "author" | "decision" | "unexplained";
  /** hunk ids, a file's together, in diff order */
  readonly hunks: ReadonlyArray<string>;
  /** the decisions whose lines fall in this unit, by id, in the why's order */
  readonly decisions: ReadonlyArray<string>;
  /** the forks whose `at` falls in this unit's hunks */
  readonly forks: ReadonlyArray<Fork>;
  /** hunks here no decision covers — worth a question to the author */
  readonly unexplained: ReadonlyArray<string>;
}

export interface Grouped {
  /** in reading order: what something is built from before what uses it */
  readonly units: ReadonlyArray<Unit>;
  readonly hunks: ReadonlyArray<Hunk>;
  /** per decision id, its pointers that matched no change: the code there
   *  did not move, or the why is older than the branch */
  readonly unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
  /** forks that fall in no hunk of the diff */
  readonly looseForks: ReadonlyArray<Fork>;
  /** decisions in no unit, by id: their pointers match no change (stale
   *  after an edit or a rebase), or they point at none — still shown, the
   *  why is the review's whether or not the diff carries its code */
  readonly outside: ReadonlyArray<string>;
}

export interface ReviewPageData {
  readonly ticket: { readonly id: string; readonly title?: string; readonly goal: string; readonly kind: string; readonly project: string };
  readonly review: {
    readonly summary: string;
    readonly branch?: string;
    readonly base?: string;
    readonly link?: string;
    readonly authorName: string;
    readonly decisions: ReadonlyArray<Decision>;
    readonly forks: ReadonlyArray<Fork>;
    readonly ts: number;
  };
  /** where the diff came from, in words for the page */
  readonly source: { readonly kind: "clone" | "host" | "none"; readonly detail: string };
  /** the branch's commit the diff was read at, when it came from a clone —
   *  what a file marked as viewed remembers, to show what moved since */
  readonly commit?: string;
  readonly grouped: Grouped | null;
  readonly links: ReadonlyArray<{ readonly label: string; readonly url: string }>;
}

/** wholeFile(ticketId, file) — the whole file as the review's
 *  branch has it, from the reader's clone, line by line; or why not. */
export type WholeFileResult = { readonly lines: ReadonlyArray<string> } | { readonly error: string };

/** sinceViewed(ticketId, file, from) — what changed in one file from
 *  the commit the reader viewed it at to the branch now, as hunks; or why
 *  not (the branch was rewritten and that commit is gone, say). */
export type SinceResult = { readonly hunks: ReadonlyArray<Hunk> } | { readonly error: string };

/** hoverAt(ticketId, file, line, col) — what the type checker says
 *  about the symbol there: markdown (a code fence with the signature, then
 *  its doc comment), nothing, that its server is still indexing (ask
 *  again), or why it could not answer. */
export type HoverResult =
  | { readonly markdown: string; readonly partial?: true }
  | { readonly none: true; readonly partial?: true }
  | { readonly missing: true }
  | { readonly indexing: true }
  | { readonly error: string };

/** One declaration a symbol resolves to. `code` is the declaration itself (a
 *  function with its body), from `line`, cut at a length with `more` lines
 *  left; null where there is no file to read (TypeScript's own library). */
export interface Peek {
  readonly file: string;
  /** in the branch, in a dependency (node_modules, vendor), or part of the
   *  language itself — then `builtInto` names it */
  readonly where: "branch" | "package" | "builtin";
  readonly builtInto?: string;
  readonly line: number;
  /** the doc comment above it, as text (markers stripped), whole or null */
  readonly doc: string | null;
  readonly code: string | null;
  readonly more: number;
}

/** definitionAt(ticketId, file, line, col) */
export type DefinitionResult = { readonly peeks: ReadonlyArray<Peek>; readonly partial?: true } | { readonly missing: true } | { readonly indexing: true } | { readonly error: string };

/** An answer that may change if asked again — the server was still
 *  indexing (`indexing`, or `partial` from a server that never said it was
 *  done), or something failed — is not one to keep. */
/** The server was still reading the project when it answered: no answer
 *  yet (`indexing`), or one that may be incomplete (`partial`). Said on the
 *  page, never shown as if it were the whole answer. */
export const stillReading = (r: HoverResult | DefinitionResult): boolean => "indexing" in r || ("partial" in r && r.partial === true);

export const final = (r: HoverResult | DefinitionResult): boolean => !("indexing" in r) && !("error" in r) && !("missing" in r) && !("partial" in r && r.partial);

/** The languages the review page can ask a language server about, each
 *  answered by a tool collagen installs on the reader's click. */
export type ToolId = "typescript" | "php";

/** Which tool answers for a file, by its extension — one table, read by the
 *  instance (which files it may be asked about) and the page (which words
 *  answer to the pointer, which offer to show). */
const TOOL_OF_EXTENSION: Readonly<Record<string, ToolId>> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "typescript", jsx: "typescript", mjs: "typescript", cjs: "typescript",
  php: "php", phtml: "php",
};
export const toolOf = (file: string): ToolId | null => TOOL_OF_EXTENSION[file.split(".").pop()?.toLowerCase() ?? ""] ?? null;
export const toolIds = (): ReadonlyArray<ToolId> => [...new Set(Object.values(TOOL_OF_EXTENSION))];

/** toolState(tool) — a pinned language server the hints need: not
 *  installed yet, being installed, or ready; installTool(tool), on the
 *  reader's click, installs it. What the offer says comes with it: the
 *  language, the tool's name, its size, and its licence where that is not
 *  open source.
 *  `notices` are messages the server itself asked to show the person. */
export interface ToolState {
  readonly tool: ToolId;
  /** the language it answers for ("PHP") and the tool itself ("Intelephense") */
  readonly language: string;
  readonly name: string;
  readonly state: "missing" | "installing" | "ready";
  readonly version: string;
  readonly size: string;
  readonly licence?: { readonly name: string; readonly url: string };
  readonly notices?: ReadonlyArray<string>;
  readonly error?: string;
}

/** Someone on the repository's host (GitHub): the person signed in through
 *  their own `gh`, or a comment's author. */
export interface HostUser {
  readonly login: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

/** The pull request a review's branch is, on its host. `mine`: the person
 *  signed in opened it — a host does not let you approve your own. */
export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  readonly draft: boolean;
  readonly author: string;
  /** the commit its head is at on the host */
  readonly head: string;
  /** "approved", "changes requested", "review required" — the host's word, when it has one */
  readonly decision?: string;
  readonly mine: boolean;
}

/** A comment on a line, or a block of lines, of the pull request's diff.
 *  `side`: the new file's line (RIGHT) or a removed line of the old one
 *  (LEFT). A block runs from `startLine` on `startSide` to `line` on `side`,
 *  and sits under its last line, as on GitHub. */
export interface LineComment {
  /** the host's id for it, or collagen's own for one said only in the room */
  readonly id: string;
  readonly author: HostUser;
  readonly body: string;
  readonly file: string;
  readonly line: number;
  readonly side: "LEFT" | "RIGHT";
  readonly startLine?: number;
  readonly startSide?: "LEFT" | "RIGHT";
  readonly url: string;
  readonly at: string;
  /** shown before the host has answered: the reader's own, on its way */
  readonly pending?: true;
  /** drafted by the reader's AI, accepted by the reader */
  readonly drafted?: true;
  /** a reply: the id of the comment it answers, in the same thread */
  readonly replyTo?: string;
}

/** A review on the pull request as its host has it: who, their verdict, and
 *  what they wrote on the whole (their line comments are LineComments). */
export interface HostReview {
  readonly id: string;
  readonly author: HostUser;
  readonly verdict: "approved" | "changes requested" | "commented" | "dismissed";
  readonly body: string;
  readonly at: string;
  readonly url: string;
}

/** A comment in the pull request's conversation — on the whole, not a line —
 *  or a line comment GitHub no longer places on a line (`outdated`: where it
 *  was, as words). */
export interface HostNote {
  readonly id: string;
  readonly author: HostUser;
  readonly body: string;
  readonly at: string;
  readonly url: string;
  readonly outdated?: string;
}

/** A comment not said yet: drafted by the reader's AI and waiting on them,
 *  or pending in their review — said with the rest when they finish it. */
export interface DraftView {
  readonly id: string;
  /** the commit it was written at — its lines are that commit's */
  readonly commit: string;
  readonly file: string;
  readonly line: number;
  readonly side: "LEFT" | "RIGHT";
  readonly startLine?: number;
  readonly startSide?: "LEFT" | "RIGHT";
  readonly body: string;
  /** pending: accepted from the reader's AI */
  readonly drafted?: true;
  /** pending: on the pull request already — a finish that stopped before the
   *  room had it; finishing again tells the room */
  readonly posted?: true;
}

/** talkView(ticketId) — the comments on the review's code that collagen
 *  holds: what the reader's AI drafted and what is pending in the reader's
 *  review (both this machine's only), and what has been said in the room —
 *  each with the host's id when it is on the pull request too, so the page
 *  shows it once. */
export interface TalkView {
  readonly drafts: ReadonlyArray<DraftView>;
  readonly pending: ReadonlyArray<DraftView>;
  readonly said: ReadonlyArray<LineComment & { readonly hostId?: string }>;
}

/** What changing drafts or pending comments did: how many, and each one that could not be, with why. */
export interface DraftsResult {
  readonly done: number;
  readonly failed: ReadonlyArray<{ readonly id: string; readonly error: string }>;
}

/** A review finished: its pending comments said — in the room, and with the
 *  verdict on the pull request when there is one — or why not (all of it
 *  stays pending then). */
/** A finish of the reader's review from the page: its own id (the same when
 *  it is sent again) and the ids of the pending comments the page showed. */
export interface Finish {
  readonly id: string;
  readonly pending: ReadonlyArray<string>;
}

export type SubmitResult =
  | {
      readonly ok: true;
      readonly said: number;
      /** the review on the host */
      readonly url?: string;
      /** said in the room only — why not on the host too (no pull request, say) */
      readonly roomOnly?: string;
      /** this finish was done already: nothing said again */
      readonly already?: true;
    }
  | {
      readonly error: string;
      /** the review reached the host, its words and verdict with it — only the
       *  room is still to be told: a new finish is a new review */
      readonly onHost?: true;
    };

/** One branch of a stack: a pull request, a review in the room, or the
 *  trunk everything builds on. */
export interface StackStep {
  readonly branch: string;
  readonly label: string;
  readonly url?: string;
  readonly number?: number;
  readonly kind: "pull" | "review" | "trunk";
}

/** The stack a review's branch sits in: what it builds on, from the trunk
 *  up, and what builds on it. */
export interface Stack {
  readonly below: ReadonlyArray<StackStep>;
  readonly here: StackStep;
  /** the chain on top of it, while there is one way up */
  readonly above: ReadonlyArray<StackStep>;
  /** where several branches build on the top of that chain: each of them */
  readonly split: ReadonlyArray<StackStep>;
}

/** hostView(ticketId) — the review on its host: who is signed in, its pull
 *  request and that request's line comments, the stack; or why there is no
 *  host (no link, none collagen knows) — the stack the room's own reviews
 *  make still comes with it. Each part says why it is missing. */
export type HostView =
  | {
      readonly host: string;
      readonly viewer: HostUser | null;
      /** not signed in, or gh is not there: how to fix it */
      readonly signIn?: string;
      readonly pull: PullRequest | null;
      /** why there is no pull request, in words */
      readonly noPull?: string;
      readonly comments: ReadonlyArray<LineComment>;
      /** the reviews on the pull request, its conversation, and line comments
       *  on code that has changed since — oldest first */
      readonly reviews: ReadonlyArray<HostReview>;
      readonly conversation: ReadonlyArray<HostNote>;
      /** when the host was asked, ISO */
      readonly checkedAt: string;
      readonly stack: Stack | null;
    }
  | { readonly none: string; readonly stack: Stack | null };

/** What a review sends: a comment, an approval, or a request for changes. */
export type Verdict = "comment" | "approve" | "request-changes";

/** What the host said to a write: done (the comment as it now stands), or
 *  its refusal in words. */
export type HostWrite = { readonly ok: true; readonly comment?: LineComment } | { readonly error: string };
