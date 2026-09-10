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
 *  guessing at a symbol. */
export type Mark =
  /** settled their step; on a review, read it and asked for nothing */
  | "approved"
  /** read it and asked for changes — a failed review step */
  | "changes"
  /** a step of theirs failed (a task, not a review) */
  | "failed"
  /** said something about it, settled nothing */
  | "spoke";

export const GLYPH: Record<Mark, string> = {
  approved: "✓",
  changes: "↻",
  failed: "✕",
  spoke: "…",
};

/** For the hint line: every glyph on screen, in the order a reader meets
 *  them. It shares one row with the section's own keys, so it is terse on
 *  purpose — a legend that gets truncated teaches nobody anything. */
export const LEGEND = `${GLYPH.approved} no changes · ${GLYPH.changes} changes asked · ${GLYPH.failed} failed · ${GLYPH.spoke} spoke`;
// and a name with no glyph: nothing from them yet. Left unsaid on purpose —
// it is what the absence of a mark obviously means, and spelling it out cost
// the row more than it fits.

/** What the mark means in words — for anything an agent reads. */
export const MARK_WORDS: Record<Mark, string> = {
  approved: "no changes asked",
  changes: "changes asked",
  failed: "failed",
  spoke: "said something",
};
