import type { Hunk } from "@collagen/review-web/data";

// Where a comment can sit on a review's code: on lines the diff shows, as
// GitHub asks of a pull request's review comments — the new file's lines
// (added or unchanged around a change) on the RIGHT, a removed line on the
// LEFT, a block within one hunk, its first line before its last. Pure: the
// diff is read from the clone (services/ReviewTalk).

export interface Spot {
  readonly file: string;
  readonly line: number;
  readonly side: "LEFT" | "RIGHT";
  readonly startLine?: number;
  readonly startSide?: "LEFT" | "RIGHT";
}

/** The row of a hunk a line is, on a side — or -1. */
const rowOf = (hunk: Hunk, side: "LEFT" | "RIGHT", line: number): number =>
  hunk.lines.findIndex((l) => (side === "RIGHT" ? l.kind !== "-" && l.new === line : l.kind === "-" && l.old === line));

/** The lines a file's hunks show, in words: "+1–12, +40–48". */
const shown = (hunks: ReadonlyArray<Hunk>): string =>
  hunks
    .map((h) => {
      const news = h.lines.flatMap((l) => (l.kind !== "-" && l.new !== undefined ? [l.new] : []));
      return news.length === 0 ? "only removed lines" : `+${news[0]}–${news[news.length - 1]}`;
    })
    .join(", ");

/** Why a comment cannot sit there, or null when it can. */
export const placeComment = (hunks: ReadonlyArray<Hunk>, spot: Spot): string | null => {
  const mine = hunks.filter((h) => h.file === spot.file);
  if (mine.length === 0) return `${spot.file} is not changed in this review's diff`;
  const sign = spot.side === "LEFT" ? "−" : "+";
  const end = mine.find((h) => rowOf(h, spot.side, spot.line) !== -1);
  if (!end) return `${spot.file} line ${sign}${spot.line} is not in the diff — it shows ${shown(mine)}${spot.side === "LEFT" ? " (side 'old' is for a removed line)" : ""}`;
  if (spot.startLine === undefined) return null;
  const startSide = spot.startSide ?? spot.side;
  const from = rowOf(end, startSide, spot.startLine);
  if (from === -1) return `a block's lines must be in one hunk: ${spot.file} ${startSide === "LEFT" ? "−" : "+"}${spot.startLine} is not in the hunk that ${sign}${spot.line} is`;
  if (from >= rowOf(end, spot.side, spot.line)) return `a block starts before it ends: ${spot.startLine} is not before ${spot.line}`;
  return null;
};
