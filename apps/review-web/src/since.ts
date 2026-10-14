import type { Hunk } from "./data";

// A file that moved since the reader viewed it: each of its hunks on the
// page shows only what changed since then, in its place — and a hunk where
// nothing moved stays folded, read already.

/** The new-file lines a hunk spans, at least its starting line. */
const span = (hunk: Hunk): readonly [number, number] => [hunk.newStart, hunk.newStart + Math.max(hunk.newLines, 1) - 1];
const overlaps = (hunk: Hunk, other: Hunk): boolean => {
  const [start, end] = span(hunk);
  const [otherStart, otherEnd] = span(other);
  return start <= otherEnd && otherStart <= end;
};

/** Where each change since the viewed commit goes: under the first of the
 *  file's hunks (in page order) it overlaps — or, when it overlaps none (a
 *  line put back as main has it, say), under the file's first hunk, so
 *  nothing that moved goes unshown. */
export const placeSince = (fileHunks: ReadonlyArray<Hunk>, since: ReadonlyArray<Hunk>): ReadonlyMap<string, ReadonlyArray<Hunk>> => {
  const out = new Map<string, Array<Hunk>>(fileHunks.map((hunk) => [hunk.id, []]));
  const first = fileHunks[0];
  if (!first) return out;
  for (const change of since) {
    const home = fileHunks.find((hunk) => overlaps(hunk, change)) ?? first;
    out.get(home.id)!.push(change);
  }
  return out;
};

/** Lines added and removed, for the label. */
export const moved = (hunks: ReadonlyArray<Hunk>): { readonly added: number; readonly removed: number } => ({
  added: hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.kind === "+").length, 0),
  removed: hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.kind === "-").length, 0),
});
