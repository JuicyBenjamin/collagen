import stringWidth from "string-width";

/** Terminal cells a string takes — not its UTF-16 length: 界 is two, an
 *  accent combined onto a letter none. */
export const cells = (s: string): number => stringWidth(s);

/** At most `max` cells of `s`, cut at the end with an ellipsis. */
export const clip = (s: string, max: number): string => {
  if (cells(s) <= max) return s;
  if (max <= 0) return "";
  let out = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) {
    if (cells(out + segment) > max - 1) break;
    out += segment;
  }
  return `${out}…`;
};

/** The fewest cells the info column keeps when the titles are long. */
export const MIN_INFO = 12;

/** A list's title and info columns in the room a pane leaves them: the
 *  titles first, whole if they fit, then the info in what is left — never
 *  under MIN_INFO, never wider than its widest — so one long annotation
 *  cannot squeeze every title. Before the pane is measured, both as wanted. */
export const fitColumns = (want: { readonly lead: number; readonly info: number }, room: number | undefined): { lead: number; info: number } => {
  if (room === undefined) return { lead: want.lead, info: want.info };
  const r = Math.max(0, room);
  const lead = Math.min(want.lead, Math.max(0, r - Math.min(want.info, MIN_INFO)));
  return { lead, info: Math.min(want.info, Math.max(0, r - lead)) };
};
