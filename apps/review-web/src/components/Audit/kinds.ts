/** What each kind of collagen tool is for, and its colour — the ticket
 *  kinds' own, so a kind looks the same in every chart on the page. */
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
export const KIND_COLOUR: Record<string, string> = {
  filing: "var(--kind-plan)",
  review: "var(--kind-review)",
  tickets: "var(--kind-task)",
  messages: "var(--kind-epic)",
  room: "var(--kind-proposal)",
  setup: "var(--faint)",
  diagnostics: "var(--kind-bug)",
  scripting: "var(--kind-investigation)",
  other: "var(--dim)",
};
export const kindWord = (kind: string): string => kind[0]!.toUpperCase() + kind.slice(1);

/** A ticket kind's own colour, as the rest of the page shows it. */
export const ticketColour = (kind: string): string =>
  `var(--kind-${kind.toLowerCase()}, var(--dim))`;

/** How a ticket ended up, and its colour: open is live work, done quiet, dropped quieter. */
export const OUTCOMES = ["Open", "Done", "Dropped"] as const;
export const OUTCOME_COLOUR: Record<(typeof OUTCOMES)[number], string> = {
  Open: "var(--color-success)",
  Done: "var(--color-neutral)",
  Dropped: "var(--faint)",
};
