import type { Hunk } from "./data";

// A file that moved since the reader viewed it: each of its hunks on the
// page shows only what changed since then, in its place — and a hunk where
// nothing moved stays folded, read already.

/** The new-file lines a hunk spans, at least its starting line. */
const span = (h: Hunk): readonly [number, number] => [h.newStart, h.newStart + Math.max(h.newLines, 1) - 1];
const overlaps = (a: Hunk, b: Hunk): boolean => {
  const [a0, a1] = span(a);
  const [b0, b1] = span(b);
  return a0 <= b1 && b0 <= a1;
};

/** Where each change since the viewed commit goes: under the first of the
 *  file's hunks (in page order) it overlaps — or, when it overlaps none (a
 *  line put back as main has it, say), under the file's first hunk, so
 *  nothing that moved goes unshown. */
export const placeSince = (fileHunks: ReadonlyArray<Hunk>, since: ReadonlyArray<Hunk>): ReadonlyMap<string, ReadonlyArray<Hunk>> => {
  const out = new Map<string, Array<Hunk>>(fileHunks.map((h) => [h.id, []]));
  const first = fileHunks[0];
  if (!first) return out;
  for (const s of since) {
    const home = fileHunks.find((h) => overlaps(h, s)) ?? first;
    out.get(home.id)!.push(s);
  }
  return out;
};

/** Lines added and removed, for the label. */
export const moved = (hunks: ReadonlyArray<Hunk>): { readonly added: number; readonly removed: number } => ({
  added: hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "+").length, 0),
  removed: hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "-").length, 0),
});
