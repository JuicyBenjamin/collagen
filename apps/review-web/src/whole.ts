import type { Hunk } from "./data";

// A hunk's file read whole: the file as the branch has it, every line
// numbered, the lines this diff adds marked as added — so the reader sees
// the change where it sits. Lines the diff removes are not in the file any
// more; the hunk itself still shows them.

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

/** The whole file as a hunk the page already knows how to draw — and to
 *  answer the pointer on, as every line has its number in the branch. */
export const wholeHunk = (hunk: Hunk, lines: ReadonlyArray<string>, added: ReadonlySet<number>): Hunk => ({
  id: `${hunk.id}~whole`,
  file: hunk.file,
  header: "",
  newStart: 1,
  newLines: lines.length,
  lines: lines.map((text, i) => ({ kind: added.has(i + 1) ? "+" : " ", text, new: i + 1 })),
});

/** A hunk with something of the new file in it — a deleted file has none to read. */
export const hasNewSide = (hunk: Hunk): boolean => hunk.lines.some((l) => l.new !== undefined);
