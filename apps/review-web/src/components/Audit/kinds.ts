/** What each kind of collagen tool is for, in the order the page lists them. */
export const KINDS = [
  "filing",
  "review",
  "tickets",
  "messages",
  "room",
  "setup",
  "scripting",
  "diagnostics",
  "other",
] as const;
export const kindWord = (kind: string): string => kind[0]!.toUpperCase() + kind.slice(1);

/** How a ticket ended up, and its colour: open is the live work, so the
 *  one colour; done and dropped are only context. */
export const OUTCOMES = ["Open", "Done", "Dropped"] as const;
export const OUTCOME_COLOUR: Record<(typeof OUTCOMES)[number], string> = {
  Open: "var(--viz-1)",
  Done: "var(--viz-context)",
  Dropped: "color-mix(in oklab, var(--viz-context) 45%, var(--panel))",
};
