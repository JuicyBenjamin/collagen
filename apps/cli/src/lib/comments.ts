import type { CommentSpot, Hunk, OnLines } from "@collagen/review-web/data";

// Where a comment can sit on a review's code: on lines the diff shows, as
// GitHub asks of a pull request's review comments — the new file's lines
// (added or unchanged around a change) on the RIGHT, a removed line on the
// LEFT, a block within one hunk, its first line before its last — or on a
// file the diff changes, with no line. Pure: the diff is read from the clone
// (services/ReviewTalk).

export type Spot = CommentSpot;

/** Where a comment is, for an agent to read: "src/a.ts:3-5 (old)", or "src/a.ts (the file)". */
export const whereOf = (spot: Spot): string =>
  spot.subject === "file" ? `${spot.file} (the file)` : `${spot.file}:${spot.startLine !== undefined ? `${spot.startLine}-` : ""}${spot.line}${spot.side === "LEFT" ? " (old)" : ""}`;

/** The row of a hunk a line is, on a side — or -1. */
const rowOf = (hunk: Hunk, side: OnLines["side"], line: number): number =>
  hunk.lines.findIndex((row) => (side === "RIGHT" ? row.kind !== "-" && row.new === line : row.kind === "-" && row.old === line));

/** The lines a file's hunks show, in words: "+1–12, +40–48". */
const shown = (hunks: ReadonlyArray<Hunk>): string =>
  hunks
    .map((hunk) => {
      const news = hunk.lines.flatMap((line) => (line.kind !== "-" && line.new !== undefined ? [line.new] : []));
      return news.length === 0 ? "only removed lines" : `+${news[0]}–${news[news.length - 1]}`;
    })
    .join(", ");

/** Why a comment cannot sit there, or null when it can. */
export const placeComment = (hunks: ReadonlyArray<Hunk>, spot: Spot): string | null => {
  const mine = hunks.filter((hunk) => hunk.file === spot.file);
  if (mine.length === 0) return `${spot.file} is not changed in this review's diff`;
  if (spot.subject === "file") return null;
  const sign = spot.side === "LEFT" ? "−" : "+";
  const end = mine.find((hunk) => rowOf(hunk, spot.side, spot.line) !== -1);
  if (!end) return `${spot.file} line ${sign}${spot.line} is not in the diff — it shows ${shown(mine)}${spot.side === "LEFT" ? " (side 'old' is for a removed line)" : ""}`;
  if (spot.startLine === undefined) return null;
  const startSide = spot.startSide ?? spot.side;
  const from = rowOf(end, startSide, spot.startLine);
  if (from === -1) return `a block's lines must be in one hunk: ${spot.file} ${startSide === "LEFT" ? "−" : "+"}${spot.startLine} is not in the hunk that ${sign}${spot.line} is`;
  if (from >= rowOf(end, spot.side, spot.line)) return `a block starts before it ends: ${spot.startLine} is not before ${spot.line}`;
  return null;
};
