// The contract between the collagen instance and the review page: what
// GET /review/<ticketId>/data answers. It lives with the page, and the cli
// imports it (apps/cli/src/lib/reviewView, services/ReviewView), so the two
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

/** A decision behind the change, as the review's why records it. */
export interface Decision {
  readonly id: string;
  readonly what: string;
  readonly userWhy?: string;
  readonly agentWhy?: string;
  readonly where: ReadonlyArray<string>;
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

export interface Section {
  readonly decision: Decision;
  /** hunk ids, in diff order */
  readonly hunks: ReadonlyArray<string>;
  /** ids of hunks another decision claims too */
  readonly shared: ReadonlyArray<string>;
  /** the forks whose `at` falls in this section's hunks */
  readonly forks: ReadonlyArray<Fork>;
  /** pointers that matched no change: the code there did not move, or the why is stale */
  readonly unmatched: ReadonlyArray<string>;
}

export interface Grouped {
  readonly sections: ReadonlyArray<Section>;
  /** hunks no decision claims — the why does not cover them, which is a finding */
  readonly unexplained: ReadonlyArray<string>;
  /** forks that fall in no decision's hunks (on unexplained code, or on none) */
  readonly looseForks: ReadonlyArray<Fork>;
  readonly hunks: ReadonlyArray<Hunk>;
}

export interface ReviewPageData {
  readonly ticket: { readonly id: string; readonly goal: string; readonly kind: string; readonly project: string };
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
  readonly grouped: Grouped | null;
  readonly links: ReadonlyArray<{ readonly label: string; readonly url: string }>;
}

/** GET /review/<ticketId>/hover?file&line&col — what the type checker says
 *  about the symbol there: markdown (a code fence with the signature, then
 *  its doc comment), nothing, or why it could not answer. */
export type HoverResult = { readonly markdown: string } | { readonly none: true } | { readonly error: string };

/** One declaration a symbol resolves to. `code` is the declaration itself (a
 *  function with its body), from `line`, cut at a length with `more` lines
 *  left; null for TypeScript's own library, which is not a file to read. */
export interface Peek {
  readonly file: string;
  readonly where: "branch" | "package" | "typescript";
  readonly line: number;
  readonly code: string | null;
  readonly more: number;
}

/** GET /review/<ticketId>/definition?file&line&col */
export type DefinitionResult = { readonly peeks: ReadonlyArray<Peek> } | { readonly error: string };
