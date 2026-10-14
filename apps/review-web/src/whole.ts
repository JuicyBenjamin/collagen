import type { DiffLine, Hunk } from "./data";

// A hunk's file read whole: the file as the branch has it, every line
// numbered, the lines this diff adds marked as added and the lines it
// removes put back where they stood, as GitHub shows them — so a line that
// was changed reads as changed, never as new.

/** Every line each file of the diff adds, by its number in the new file. */
export const addedLines = (hunks: ReadonlyArray<Hunk>): ReadonlyMap<string, ReadonlySet<number>> => {
  const fileLines = new Map<string, Set<number>>();
  for (const hunk of hunks)
    for (const line of hunk.lines)
      if (line.kind === "+" && line.new !== undefined) {
        const lineNumbers = fileLines.get(hunk.file) ?? new Set<number>();
        lineNumbers.add(line.new);
        fileLines.set(hunk.file, lineNumbers);
      }
  return fileLines;
};

/** Every line each file of the diff removes, by the line of the new file it
 *  stood just before (one past the file's end when it was at the end). */
export const removedLines = (hunks: ReadonlyArray<Hunk>): ReadonlyMap<string, ReadonlyMap<number, ReadonlyArray<DiffLine>>> => {
  const removedByFile = new Map<string, Map<number, Array<DiffLine>>>();
  for (const hunk of hunks) {
    const file = removedByFile.get(hunk.file) ?? new Map<number, Array<DiffLine>>();
    let pending: Array<DiffLine> = [];
    // a hunk with no new lines starts after newStart; else after the last new line seen
    let after = hunk.newStart;
    const flush = (before: number) => {
      if (pending.length > 0) file.set(before, [...(file.get(before) ?? []), ...pending]);
      pending = [];
    };
    for (const line of hunk.lines) {
      if (line.kind === "-") pending.push(line);
      else if (line.new !== undefined) {
        flush(line.new);
        after = line.new;
      }
    }
    flush(after + 1);
    removedByFile.set(hunk.file, file);
  }
  return removedByFile;
};

/** The whole file as a hunk the page already knows how to draw — and to
 *  answer the pointer on, as every line of the branch has its number; a
 *  removed line carries only its old one. */
export const wholeHunk = (hunk: Hunk, lines: ReadonlyArray<string>, added: ReadonlySet<number>, removed: ReadonlyMap<number, ReadonlyArray<DiffLine>> = new Map()): Hunk => ({
  id: `${hunk.id}~whole`,
  file: hunk.file,
  header: "",
  newStart: 1,
  newLines: lines.length,
  lines: [
    ...lines.flatMap((text, index): ReadonlyArray<DiffLine> => [...(removed.get(index + 1) ?? []), { kind: added.has(index + 1) ? "+" : " ", text, new: index + 1 }]),
    ...(removed.get(lines.length + 1) ?? []),
  ],
});

/** A hunk with something of the new file in it — a deleted file has none to read. */
export const hasNewSide = (hunk: Hunk): boolean => hunk.lines.some((line) => line.new !== undefined);
