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
