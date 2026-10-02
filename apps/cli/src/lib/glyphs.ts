/** The marks the lists use, in one place, so the same thing never means two
 *  things on two screens. A glyph says what a person DID — not whether the
 *  app is pleased about it: a review asking for changes is a complete,
 *  successful review, and `✓` would be a lie about it.
 *
 *  There is deliberately NO glyph for "asked, nothing yet". A bare name says
 *  that, and a dot said it worse: it read as a spacer between names rather
 *  than a state of its own.
 *
 *  Whoever adds a state here adds it to `LEGEND` too, or the reader is left
 *  guessing at a symbol — and to `MARK_HELP`, which the compiler insists on. */
export type Mark =
  /** on the ROW, not on a person: this ticket is yours to act on now */
  | "yours"
  /** settled their step; on a review, read it and asked for nothing */
  | "approved"
  /** read it and asked for changes — a failed review step */
  | "changes"
  /** a step of theirs failed (a task, not a review) */
  | "failed"
  /** said something about it, settled nothing */
  | "spoke";

export const GLYPH: Record<Mark, string> = {
  yours: "▸",
  approved: "✓",
  changes: "↻",
  failed: "✕",
  spoke: "…",
};

/** Marks about ORDER, not people (a ticket's `after`): the row follows the
 *  one above it in its group, or still waits on one that is not answered.
 *  Only the author ever sees a waiting row — nobody else is shown it. */
export const STACK = { follows: "↳", waits: "⧗" } as const;

export const STACK_HELP: Record<keyof typeof STACK, string> = {
  follows: "read after the ticket it sits under, one level deeper per step of a chain (after) — a stacked review, a second phase",
  waits: "yours, waiting on a ticket not yet answered: nobody else is shown it until then",
};

/** An epic's row: folded (its tickets inside, unseen) or open. */
export const FOLD = { folded: "+", open: "−" } as const;

export const FOLD_HELP: Record<keyof typeof FOLD, string> = {
  folded: "an epic, folded: its tickets are inside — space opens it (a ▸ on it means one of them is yours now)",
  open: "an epic, open: its tickets are listed under it, each with its project — space folds it",
};

/** For the hint line: every glyph on screen, in the order a reader meets
 *  them. It shares one row with the section's own keys, so it is terse on
 *  purpose — a legend that gets truncated teaches nobody anything. */
export const LEGEND = `${GLYPH.yours} yours now · ${GLYPH.approved} no changes · ${GLYPH.changes} changes asked · ${GLYPH.failed} failed · ${GLYPH.spoke} spoke · ${STACK.follows} after the one it sits under · ${STACK.waits} waiting`;
// and a name with no glyph: nothing from them yet. Left unsaid on purpose —
// it is what the absence of a mark obviously means, and spelling it out cost
// the row more than it fits.

/** What the mark means in a full sentence — the ? panel's line for it. */
export const MARK_HELP: Record<Mark, string> = {
  yours: "on the row, not a person: this ticket is yours to act on now",
  changes: "someone read it and asked for changes",
  failed: "a step of someone's failed",
  approved: "someone settled their step — on a review, read it and asked for nothing",
  spoke: "someone said something about it, and settled nothing",
};

/** The marks in the order a reader meets them on a row. */
export const MARK_ORDER: ReadonlyArray<Mark> = ["yours", "changes", "failed", "approved", "spoke"];

/** What the mark means in words — for anything an agent reads. */
export const MARK_WORDS: Record<Mark, string> = {
  yours: "yours to act on now",
  approved: "no changes asked",
  changes: "changes asked",
  failed: "failed",
  spoke: "said something",
};
