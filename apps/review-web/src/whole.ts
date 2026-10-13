import type { DiffLine, Hunk } from "./data";

// A hunk's file read whole: the file as the branch has it, every line
// numbered, the lines this diff adds marked as added and the lines it
// removes put back where they stood, as GitHub shows them — so a line that
// was changed reads as changed, never as new.

/** Every line each file of the diff adds, by its number in the new file. */
export const addedLines = (hunks: ReadonlyArray<Hunk>): ReadonlyMap<string, ReadonlySet<number>> => {
  const m = new Map<string, Set<number>>();
  for (const h of hunks)
    for (const l of h.lines)
      if (l.kind === "+" && l.new !== undefined) {
        const s = m.get(h.file) ?? new Set<number>();
        s.add(l.new);
        m.set(h.file, s);
      }
  return m;
};

/** Every line each file of the diff removes, by the line of the new file it
 *  stood just before (one past the file's end when it was at the end). */
export const removedLines = (hunks: ReadonlyArray<Hunk>): ReadonlyMap<string, ReadonlyMap<number, ReadonlyArray<DiffLine>>> => {
  const m = new Map<string, Map<number, Array<DiffLine>>>();
  for (const h of hunks) {
    const file = m.get(h.file) ?? new Map<number, Array<DiffLine>>();
    let pending: Array<DiffLine> = [];
    // a hunk with no new lines starts after newStart; else after the last new line seen
    let after = h.newStart;
    const flush = (before: number) => {
      if (pending.length > 0) file.set(before, [...(file.get(before) ?? []), ...pending]);
      pending = [];
    };
    for (const l of h.lines) {
      if (l.kind === "-") pending.push(l);
      else if (l.new !== undefined) {
        flush(l.new);
        after = l.new;
      }
    }
    flush(after + 1);
    m.set(h.file, file);
  }
  return m;
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
    ...lines.flatMap((text, i): ReadonlyArray<DiffLine> => [...(removed.get(i + 1) ?? []), { kind: added.has(i + 1) ? "+" : " ", text, new: i + 1 }]),
    ...(removed.get(lines.length + 1) ?? []),
  ],
});

/** A hunk with something of the new file in it — a deleted file has none to read. */
export const hasNewSide = (hunk: Hunk): boolean => hunk.lines.some((l) => l.new !== undefined);
