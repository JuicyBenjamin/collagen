// Where a comment's lines stand after the branch moved under it: read from
// the diff between the commit it was written at and the one shown now. Lines
// before, between and after the changes keep their place, shifted by what
// was added and taken out above them; a line the diff changed or removed is
// gone, and a comment on it is outdated — never moved onto other code. A
// block moved whole, found once and only once in the file now, is followed
// there. Pure: the diff and the file's text come from the clone
// (services/ReviewFollow).

/** One change of a `git diff -U0`: the old file's lines it takes out, and the new file's it puts in. */
export interface Change {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
}

/** The changes of a `git diff -U0`, read from its hunk headers. */
export const changesOf = (diff: string): ReadonlyArray<Change> =>
  [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((header) => ({
    oldStart: Number(header[1]),
    oldLines: header[2] === undefined ? 1 : Number(header[2]),
    newStart: Number(header[3]),
    newLines: header[4] === undefined ? 1 : Number(header[4]),
  }));

/** Where one line of the old file stands in the new one, or null when a change took it. */
export const followLine = (changes: ReadonlyArray<Change>, line: number): number | null => {
  let shift = 0;
  for (const change of changes) {
    // nothing taken out: lines put in after oldStart
    if (change.oldLines === 0) {
      if (line > change.oldStart) shift += change.newLines;
    } else if (line >= change.oldStart && line < change.oldStart + change.oldLines) return null;
    else if (line >= change.oldStart + change.oldLines) shift += change.newLines - change.oldLines;
  }
  return line + shift;
};

/** Where a block of the old file's lines stands in the new one: every line of
 *  it kept, or null. Lines put in inside it make it longer, as they would. */
export const followBlock = (changes: ReadonlyArray<Change>, from: number, to: number): { readonly from: number; readonly to: number } | null => {
  for (let line = from; line <= to; line++) if (followLine(changes, line) === null) return null;
  return { from: followLine(changes, from)!, to: followLine(changes, to)! };
};

/** A block too slight to recognise elsewhere: a brace, a blank, `return;`. */
const SLIGHT = 12;

/** Where a block of the old file's lines went whole, when the new file has it
 *  exactly once — moved, not changed. Null when it is not there, there more
 *  than once, or too slight to tell apart. */
export const findMoved = (before: ReadonlyArray<string>, after: ReadonlyArray<string>, from: number, to: number): { readonly from: number; readonly to: number } | null => {
  const block = before.slice(from - 1, to);
  if (block.length === 0 || block.length !== to - from + 1 || block.join("").replace(/\s/g, "").length < SLIGHT) return null;
  let found: number | null = null;
  for (let start = 0; start + block.length <= after.length; start++) {
    if (!block.every((line, index) => after[start + index] === line)) continue;
    if (found !== null) return null;
    found = start + 1;
  }
  return found === null ? null : { from: found, to: found + block.length - 1 };
};
