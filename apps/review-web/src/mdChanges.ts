import type { Hunk } from "./data";
import { parseDocument, type Block, type Inline, type Item, type RowMark } from "./markdown";
import { removedLines } from "./whole";

// A changed Markdown file read as what changed: the blocks this diff adds
// and the ones it takes out, each rendered, in the order they stand, and
// nothing else — as code shows its changes. A list is weighed item by item.
// A block the diff only edited reads once, the words it took out and put in
// marked in place, as a code line changed in place does. The file before
// the change is put back together from the branch's file and the diff's hunks.

/** One block the diff touched: what it says now, what it said, or (edited) both in one. */
export interface ChangedBlock {
  readonly kind: "added" | "removed" | "edited";
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

/** Formatting a word sits inside, outermost first. */
type Wrap = { readonly kind: "strong" | "em" | "del" | "sub" | "sup" } | { readonly kind: "link"; readonly href: string };
/** One word, run of spaces, mark, code span, image or break, with what it sits in. */
interface Atom {
  readonly leaf: Inline;
  readonly wraps: ReadonlyArray<Wrap>;
  readonly key: string;
  /** what it weighs in how alike two blocks are: nothing for spaces */
  readonly weight: number;
}

const WORD = /[\p{L}\p{N}_$]+|\s+|[^]/gu;
const atom = (leaf: Inline, wraps: ReadonlyArray<Wrap>): Atom => ({
  leaf,
  wraps,
  key: JSON.stringify([wraps, leaf]),
  weight: leaf.kind === "text" && /^\s+$/.test(leaf.text) ? 0 : 1,
});
const atomsOf = (nodes: ReadonlyArray<Inline>, wraps: ReadonlyArray<Wrap> = []): ReadonlyArray<Atom> =>
  nodes.flatMap((node): ReadonlyArray<Atom> => {
    switch (node.kind) {
      case "text":
        return (node.text.match(WORD) ?? []).map((piece) => atom({ kind: "text", text: piece }, wraps));
      case "code":
      case "image":
      case "br":
        return [atom(node, wraps)];
      case "link":
        return atomsOf(node.children, [...wraps, { kind: "link", href: node.href }]);
      case "came":
      case "went":
        return atomsOf(node.children, wraps);
      default:
        return atomsOf(node.children, [...wraps, { kind: node.kind }]);
    }
  });

/** Atoms back into inline nodes: each run inside the same formatting, formatted once; words side by side, one text. */
const inlinesOf = (atoms: ReadonlyArray<Atom>, depth = 0): ReadonlyArray<Inline> => {
  const nodes: Array<Inline> = [];
  for (let index = 0; index < atoms.length; ) {
    const first = atoms[index]!;
    const wrap = first.wraps[depth];
    if (!wrap) {
      const last = nodes.at(-1);
      if (first.leaf.kind === "text" && last?.kind === "text") nodes[nodes.length - 1] = { kind: "text", text: last.text + first.leaf.text };
      else nodes.push(first.leaf);
      index++;
      continue;
    }
    const same = JSON.stringify(wrap);
    let end = index;
    while (end < atoms.length && JSON.stringify(atoms[end]!.wraps[depth]) === same) end++;
    const children = inlinesOf(atoms.slice(index, end), depth + 1);
    nodes.push(wrap.kind === "link" ? { kind: "link", href: wrap.href, children } : { kind: wrap.kind, children });
    index = end;
  }
  return nodes;
};

/** Past this many cells two blocks are too long to weigh word by word: they read as one out, one in. */
const MAX_CELLS = 1_000_000;
/** How alike two blocks must be to read as one edited: what they share, over what they say. */
const ALIKE = 0.5;

interface Merged<T> {
  readonly merged: T;
  readonly shared: number;
  readonly total: number;
}

/** Two runs of words as one: what stayed, what went (struck) and what came (marked), in order. */
const mergeInlines = (old: ReadonlyArray<Inline>, now: ReadonlyArray<Inline>): Merged<ReadonlyArray<Inline>> | null => {
  const before = atomsOf(old);
  const after = atomsOf(now);
  const total = [...before, ...after].reduce((sum, each) => sum + each.weight, 0);
  let head = 0;
  while (head < before.length && head < after.length && before[head]!.key === after[head]!.key) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail]!.key === after[after.length - 1 - tail]!.key) tail++;
  const oldMiddle = before.slice(head, before.length - tail);
  const newMiddle = after.slice(head, after.length - tail);
  if (oldMiddle.length * newMiddle.length > MAX_CELLS) return null;

  // longest common run of words, by weight
  const width = newMiddle.length + 1;
  const best = new Uint32Array((oldMiddle.length + 1) * width);
  for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex--)
    for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex--)
      best[oldIndex * width + newIndex] =
        oldMiddle[oldIndex]!.key === newMiddle[newIndex]!.key
          ? best[(oldIndex + 1) * width + newIndex + 1]! + 1 + oldMiddle[oldIndex]!.weight
          : Math.max(best[(oldIndex + 1) * width + newIndex]!, best[oldIndex * width + newIndex + 1]!);

  type Step = { readonly kind: "same" | "went" | "came"; readonly atom: Atom };
  const steps: Array<Step> = before.slice(0, head).map((each) => ({ kind: "same", atom: each }));
  for (let oldIndex = 0, newIndex = 0; oldIndex < oldMiddle.length || newIndex < newMiddle.length; ) {
    const oldAtom = oldMiddle[oldIndex];
    const newAtom = newMiddle[newIndex];
    if (oldAtom && newAtom && oldAtom.key === newAtom.key && best[oldIndex * width + newIndex] === best[(oldIndex + 1) * width + newIndex + 1]! + 1 + oldAtom.weight) {
      steps.push({ kind: "same", atom: newAtom });
      oldIndex++;
      newIndex++;
    } else if (oldAtom && (!newAtom || best[(oldIndex + 1) * width + newIndex]! >= best[oldIndex * width + newIndex + 1]!)) {
      steps.push({ kind: "went", atom: oldAtom });
      oldIndex++;
    } else {
      steps.push({ kind: "came", atom: newAtom! });
      newIndex++;
    }
  }
  steps.push(...after.slice(after.length - tail).map((each): Step => ({ kind: "same", atom: each })));
  const shared = steps.reduce((sum, step) => sum + (step.kind === "same" ? 2 * step.atom.weight : 0), 0);

  // a space alone between two changes is part of them: "old word" to "new text" reads as one out, one in
  const gathered: Array<Step> = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    const changes = (at: number) => steps[at] !== undefined && steps[at]!.kind !== "same";
    if (step.kind === "same" && step.atom.weight === 0 && changes(index - 1) && changes(index + 1)) gathered.push({ kind: "went", atom: step.atom }, { kind: "came", atom: step.atom });
    else gathered.push(step);
  }
  // within a change, what went first, then what came
  const ordered: Array<Step> = [];
  for (let index = 0; index < gathered.length; ) {
    if (gathered[index]!.kind === "same") ordered.push(gathered[index++]!);
    else {
      let end = index;
      while (end < gathered.length && gathered[end]!.kind !== "same") end++;
      const change = gathered.slice(index, end);
      ordered.push(...change.filter((step) => step.kind === "went"), ...change.filter((step) => step.kind === "came"));
      index = end;
    }
  }

  const merged: Array<Inline> = [];
  for (let index = 0; index < ordered.length; ) {
    const kind = ordered[index]!.kind;
    let end = index;
    while (end < ordered.length && ordered[end]!.kind === kind) end++;
    const children = inlinesOf(ordered.slice(index, end).map((step) => step.atom));
    merged.push(...(kind === "same" ? children : [{ kind, children }]));
    index = end;
  }
  return { merged, shared, total };
};

const mergeAll = <T,>(old: ReadonlyArray<T>, now: ReadonlyArray<T>, one: (old: T, now: T) => Merged<T> | null): Merged<ReadonlyArray<T>> | null => {
  if (old.length !== now.length) return null;
  const merged: Array<T> = [];
  let shared = 0;
  let total = 0;
  for (let index = 0; index < old.length; index++) {
    const pair = one(old[index]!, now[index]!);
    if (!pair) return null;
    merged.push(pair.merged);
    shared += pair.shared;
    total += pair.total;
  }
  return { merged, shared, total };
};

type Table = Extract<Block, { kind: "table" }>;
type Row = Table["rows"][number];

/** A table and its edit as one: only the rows the diff touched, each marked —
 *  added, taken out, or, alike enough, edited with its words marked. Rows
 *  that stayed are left out, as unchanged blocks are. */
const mergeTable = (old: Table, now: Table): Merged<Block> | null => {
  if (old.head.length !== now.head.length || old.rows.length * now.rows.length > MAX_CELLS) return null;
  const key = (row: Row) => JSON.stringify(row);
  const width = now.rows.length + 1;
  const best = new Uint32Array((old.rows.length + 1) * width);
  for (let oldIndex = old.rows.length - 1; oldIndex >= 0; oldIndex--)
    for (let newIndex = now.rows.length - 1; newIndex >= 0; newIndex--)
      best[oldIndex * width + newIndex] =
        key(old.rows[oldIndex]!) === key(now.rows[newIndex]!) ? best[(oldIndex + 1) * width + newIndex + 1]! + 1 : Math.max(best[(oldIndex + 1) * width + newIndex]!, best[oldIndex * width + newIndex + 1]!);
  const rows: Array<Row> = [];
  const marks: Array<RowMark> = [];
  let went: Array<Row> = [];
  let came: Array<Row> = [];
  // rows taken out and put in at one place: each taken one paired, in order, with the first put-in one it reads as an edit of
  const settle = () => {
    let nextCame = 0;
    for (const gone of went) {
      const at = came.findIndex((row, index) => index >= nextCame && editedRow(gone, row) !== null);
      if (at < 0) {
        rows.push(gone);
        marks.push("went");
        continue;
      }
      for (const row of came.slice(nextCame, at)) rows.push(row), marks.push("came");
      rows.push(editedRow(gone, came[at]!)!);
      marks.push("edited");
      nextCame = at + 1;
    }
    for (const row of came.slice(nextCame)) rows.push(row), marks.push("came");
    went = [];
    came = [];
  };
  for (let oldIndex = 0, newIndex = 0; oldIndex < old.rows.length || newIndex < now.rows.length; ) {
    const oldRow = old.rows[oldIndex];
    const newRow = now.rows[newIndex];
    if (oldRow && newRow && key(oldRow) === key(newRow)) {
      settle();
      oldIndex++;
      newIndex++;
    } else if (oldRow && (!newRow || best[(oldIndex + 1) * width + newIndex]! >= best[oldIndex * width + newIndex + 1]!)) {
      went.push(oldRow);
      oldIndex++;
    } else {
      came.push(newRow!);
      newIndex++;
    }
  }
  settle();
  const head = mergeAll(old.head, now.head, mergeInlines);
  // a table is the same table whatever its rows: it always reads as one
  return { merged: { kind: "table", head: head?.merged ?? now.head, rows, marks }, shared: 1, total: 1 };
};

/** A row and its edit as one, cell by cell, when alike enough to read so. */
const editedRow = (old: Row, now: Row): Row | null => {
  const cells = mergeAll(old, now, mergeInlines);
  return cells && cells.total > 0 && cells.shared / cells.total >= ALIKE ? cells.merged : null;
};

/** One block an edit of another, in one: words merged, as long as they are the same kind of block. */
const mergeBlock = (old: Block, now: Block): Merged<Block> | null => {
  if (old.kind === "table" && now.kind === "table") return mergeTable(old, now);
  if (old.kind === "p" && now.kind === "p") {
    const words = mergeInlines(old.children, now.children);
    return words && { ...words, merged: { kind: "p", children: words.merged } };
  }
  if (old.kind === "heading" && now.kind === "heading" && old.depth === now.depth) {
    const words = mergeInlines(old.children, now.children);
    return words && { ...words, merged: { ...now, children: words.merged } };
  }
  if (old.kind === "quote" && now.kind === "quote") {
    const blocks = mergeAll(old.blocks, now.blocks, mergeBlock);
    return blocks && { ...blocks, merged: { kind: "quote", blocks: blocks.merged } };
  }
  if (old.kind === "list" && now.kind === "list" && (old.start === undefined) === (now.start === undefined)) {
    const items = mergeAll(old.items, now.items, (oldItem: Item, newItem: Item): Merged<Item> | null => {
      const blocks = mergeAll(oldItem.blocks, newItem.blocks, mergeBlock);
      return blocks && { ...blocks, merged: { ...newItem, blocks: blocks.merged } };
    });
    return items && { ...items, merged: { ...now, items: items.merged } };
  }
  return null;
};

/** A block taken out and one put in as one edited block, when they are alike enough to read so. */
const edited = (old: ReadonlyArray<Block>, now: ReadonlyArray<Block>): ReadonlyArray<Block> | null => {
  const blocks = mergeAll(old, now, mergeBlock);
  return blocks && blocks.total > 0 && blocks.shared / blocks.total >= ALIKE ? blocks.merged : null;
};

type Placed = { readonly kind: ChangedBlock["kind"]; readonly blocks: ReadonlyArray<Block>; readonly at: number; readonly end: number };

/** The blocks a file's diff adds and removes, in reading order: a block it
 *  took out comes before the one that now stands where it was, or, edited,
 *  reads as one with it. */
export const changedBlocks = (newSource: string, hunks: ReadonlyArray<Hunk>): ReadonlyArray<ChangedBlock> => {
  const file = hunks[0]?.file;
  if (file === undefined) return [];
  const added = new Set<number>();
  for (const hunk of hunks) for (const line of hunk.lines) if (line.kind === "+" && line.new !== undefined) added.add(line.new);
  // each removed old line, by the new line it stood before
  const before = new Map<number, number>();
  for (const [newLine, lines] of removedLines(hunks).get(file) ?? new Map()) for (const line of lines) if (line.old !== undefined) before.set(line.old, newLine);

  const fresh = parseDocument(newSource, { items: true });
  const touches = (from: number, to: number, lines: (line: number) => boolean) => {
    for (let line = from; line <= to; line++) if (lines(line)) return true;
    return false;
  };
  const placed: Array<Placed> = [];
  for (const section of fresh) if (touches(section.from, section.to, (line) => added.has(line))) placed.push({ kind: "added", blocks: section.blocks, at: section.from, end: section.to });
  for (const section of parseDocument(oldSource(newSource, hunks), { items: true })) {
    let at = Infinity;
    for (let line = section.from; line <= section.to; line++) at = Math.min(at, before.get(line) ?? Infinity);
    if (at === Infinity) continue;
    // what it stood before is inside a block the diff changed (a paragraph with one line rewritten): it goes before that block
    const within = placed.find((block) => block.kind === "added" && block.at <= at && at <= block.end);
    const place = within ? within.at : at;
    placed.push({ kind: "removed", blocks: section.blocks, at: place, end: place - 1 });
  }
  placed.sort((first, second) => first.at - second.at || (first.kind === second.kind ? 0 : first.kind === "removed" ? -1 : 1));

  const unchanged = fresh.filter((section) => !touches(section.from, section.to, (line) => added.has(line)));
  const apart = (from: number, to: number) => unchanged.some((section) => section.from >= from && section.to < to);

  // blocks taken out, then the ones put in right where they were: each taken one paired, in order, with the first put-in one it reads as an edit of
  const shown: Array<Placed> = [];
  for (let index = 0; index < placed.length; ) {
    if (placed[index]!.kind !== "removed") {
      shown.push(placed[index++]!);
      continue;
    }
    const removed: Array<Placed> = [];
    while (index < placed.length && placed[index]!.kind === "removed") removed.push(placed[index++]!);
    const put: Array<Placed> = [];
    let reach = removed.at(-1)!.at;
    while (index < placed.length && placed[index]!.kind === "added" && !apart(reach, placed[index]!.at)) {
      put.push(placed[index]!);
      reach = placed[index++]!.end + 1;
    }
    let nextRemoved = 0;
    let nextPut = 0;
    for (const [removedAt, gone] of removed.entries()) {
      for (let putAt = nextPut; putAt < put.length; putAt++) {
        const both = edited(gone.blocks, put[putAt]!.blocks);
        if (!both) continue;
        shown.push(...removed.slice(nextRemoved, removedAt), ...put.slice(nextPut, putAt), { kind: "edited", blocks: both, at: put[putAt]!.at, end: put[putAt]!.end });
        nextRemoved = removedAt + 1;
        nextPut = putAt + 1;
        break;
      }
    }
    shown.push(...removed.slice(nextRemoved), ...put.slice(nextPut));
  }

  // blocks added (or taken out) one after another read as one stretch, the items of one list as one list again
  let shownUpTo = 0;
  const stretches: Array<ChangedBlock> = [];
  for (const block of shown) {
    const gapBefore = unchanged.some((section) => section.from > shownUpTo && section.to < block.at);
    shownUpTo = Math.max(shownUpTo, block.end);
    const last = stretches.at(-1);
    if (last && !gapBefore && last.kind === block.kind && block.kind !== "edited") stretches[stretches.length - 1] = { ...last, blocks: joinLists([...last.blocks, ...block.blocks]) };
    else stretches.push({ kind: block.kind, blocks: block.blocks, gapBefore });
  }
  return stretches;
};

/** Lists side by side as one, numbered from the first: a list's items, read apart, back together. */
const joinLists = (blocks: ReadonlyArray<Block>): ReadonlyArray<Block> =>
  blocks.reduce<Array<Block>>((joined, block) => {
    const last = joined.at(-1);
    if (last?.kind === "list" && block.kind === "list" && (last.start === undefined) === (block.start === undefined)) joined[joined.length - 1] = { ...last, items: [...last.items, ...block.items] };
    else joined.push(block);
    return joined;
  }, []);
