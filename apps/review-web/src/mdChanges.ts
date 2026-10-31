import type { Hunk } from "./data";
import { parseDocument, type Block } from "./markdown";
import { removedLines } from "./whole";

// A changed Markdown file read as what changed: the blocks this diff adds
// and the ones it takes out, each rendered, in the order they stand, and
// nothing else — as code shows its changes. The file before the change is
// put back together from the branch's file and the diff's hunks.

/** One block the diff touched: what it says now, or what it said. */
export interface ChangedBlock {
  readonly kind: "added" | "removed";
  readonly blocks: ReadonlyArray<Block>;
  /** unchanged blocks stand between this and the one before (or the file's top) */
  readonly gapBefore: boolean;
}

/** The file as it was before the diff: each hunk's new lines put back to its old ones. */
export const oldSource = (newSource: string, hunks: ReadonlyArray<Hunk>): string => {
  const lines = newSource.split("\n");
  for (const hunk of [...hunks].sort((first, second) => second.newStart - first.newStart)) {
    const old = hunk.lines.filter((line) => line.kind !== "+").map((line) => line.text);
    // a hunk with no new lines sits after newStart; otherwise it starts there
    lines.splice(hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1, hunk.newLines, ...old);
  }
  return lines.join("\n");
};

/** The blocks a file's diff adds and removes, in reading order: a block it
 *  took out comes before the one that now stands where it was. */
export const changedBlocks = (newSource: string, hunks: ReadonlyArray<Hunk>): ReadonlyArray<ChangedBlock> => {
  const file = hunks[0]?.file;
  if (file === undefined) return [];
  const added = new Set<number>();
  for (const hunk of hunks) for (const line of hunk.lines) if (line.kind === "+" && line.new !== undefined) added.add(line.new);
  // each removed old line, by the new line it stood before
  const before = new Map<number, number>();
  for (const [newLine, lines] of removedLines(hunks).get(file) ?? new Map()) for (const line of lines) if (line.old !== undefined) before.set(line.old, newLine);

  const fresh = parseDocument(newSource);
  const touches = (from: number, to: number, lines: (line: number) => boolean) => {
    for (let line = from; line <= to; line++) if (lines(line)) return true;
    return false;
  };
  type Placed = { readonly kind: "added" | "removed"; readonly blocks: ReadonlyArray<Block>; readonly at: number; readonly end: number };
  const placed: Array<Placed> = [];
  for (const section of fresh) if (touches(section.from, section.to, (line) => added.has(line))) placed.push({ kind: "added", blocks: section.blocks, at: section.from, end: section.to });
  for (const section of parseDocument(oldSource(newSource, hunks))) {
    let at = Infinity;
    for (let line = section.from; line <= section.to; line++) at = Math.min(at, before.get(line) ?? Infinity);
    if (at === Infinity) continue;
    // what it stood before is inside a block the diff changed (a list with one item rewritten): it goes before that block
    const within = placed.find((block) => block.kind === "added" && block.at <= at && at <= block.end);
    const place = within ? within.at : at;
    placed.push({ kind: "removed", blocks: section.blocks, at: place, end: place - 1 });
  }
  placed.sort((first, second) => first.at - second.at || (first.kind === second.kind ? 0 : first.kind === "removed" ? -1 : 1));

  const unchanged = fresh.filter((section) => !touches(section.from, section.to, (line) => added.has(line)));
  let shownUpTo = 0;
  return placed.map((block) => {
    const gapBefore = unchanged.some((section) => section.from > shownUpTo && section.to < block.at);
    shownUpTo = Math.max(shownUpTo, block.end);
    return { kind: block.kind, blocks: block.blocks, gapBefore };
  });
};
