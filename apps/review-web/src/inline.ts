import type { DiffLine } from "./data";
import type { Span } from "./highlight";

// A line changed in place, read as one line: a removed line and the added
// line that took its place are paired, and their words diffed, so the
// reader sees what was added and what was taken away instead of reading two
// whole lines to find it. Done at render time from a hunk's lines; the diff
// the server sends is untouched.

export interface Segment {
  /** moved: the same words, somewhere else in the line — shown once, where they are now */
  readonly kind: "same" | "removed" | "added" | "moved";
  readonly text: string;
  /** where it starts in its own line: the old one for removed, else the new */
  readonly at: number;
}

/** Where a piece of the new line stood in the old one: kept and moved words
 *  alike — what "before" on hover lights up. Offsets into each line. */
export interface Was {
  readonly now: number;
  readonly was: number;
  readonly length: number;
}

/** A line that only changed order: how many of its words moved, of how many. */
export interface Reorder {
  readonly moved: number;
  readonly words: number;
}

/** A row as drawn: a line of the diff, or — `was` set — an added line that
 *  took the place of a removed one, both numbers on one row. `carries`: an
 *  added line that goes on with the row above — a line split in two, its
 *  words unchanged. `index` is the line's place in the hunk's lines. */
export interface Row {
  readonly line: DiffLine;
  readonly index: number;
  readonly was?: { readonly line: DiffLine; readonly index: number; readonly segments: ReadonlyArray<Segment>; readonly map: ReadonlyArray<Was>; readonly reorder: Reorder | null };
  readonly carries?: true;
}

/** Half the line's code shared: below that, red and green would cover most
 *  of the row and read worse than two plain lines; at or above it, what
 *  stays is at least as much as what moved, so marking the difference is
 *  the shorter read. Counted on code, not whitespace, so two unrelated
 *  lines with the same indentation never pair. */
const SIMILAR = 0.5;
/** The most token-pairs one line's diff may weigh, after their common start
 *  and end are set aside; beyond it the lines stay apart. */
const MAX_CELLS = 40_000;
/** The largest run of removed by added lines weighed for pairs. */
const MAX_RUN_CELLS = 250_000;
/** How far apart, in the runs, a removed and an added line may be and still pair. */
const BAND = 8;
/** The most lines one line is read as split over. */
const SPLIT_INTO = 4;
/** The least code a line needs to be read as split: shorter, any few added lines could spell it. */
const SPLIT_CODE = 8;

const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^]/gu;
const tokens = (text: string): Array<string> => text.match(TOKEN) ?? [];
const blank = (token: string) => /^\s+$/.test(token);
const weight = (token: string) => (blank(token) ? 0 : token.length);

interface Diff {
  /** shared code over the longer line's code */
  readonly similarity: number;
  readonly segments: ReadonlyArray<Segment>;
  readonly map: ReadonlyArray<Was>;
  readonly reorder: Reorder | null;
}

/** Two lines diffed by word: identifiers and numbers, runs of whitespace,
 *  single punctuation. Null when they are too long to weigh. */
export function wordDiff(old: string, now: string): Diff | null {
  const oldTokens = tokens(old);
  const newTokens = tokens(now);
  let head = 0;
  while (head < oldTokens.length && head < newTokens.length && oldTokens[head] === newTokens[head]) head++;
  let tail = 0;
  while (tail < oldTokens.length - head && tail < newTokens.length - head && oldTokens[oldTokens.length - 1 - tail] === newTokens[newTokens.length - 1 - tail]) tail++;
  const oldMiddle = oldTokens.length - head - tail;
  const newMiddle = newTokens.length - head - tail;
  if (oldMiddle * newMiddle > MAX_CELLS) return null;

  // longest common subsequence of the middles, by code weight
  const width = newMiddle + 1;
  const best = new Uint32Array((oldMiddle + 1) * width);
  for (let oldIndex = oldMiddle - 1; oldIndex >= 0; oldIndex--)
    for (let newIndex = newMiddle - 1; newIndex >= 0; newIndex--)
      best[oldIndex * width + newIndex] = oldTokens[head + oldIndex] === newTokens[head + newIndex] ? best[(oldIndex + 1) * width + newIndex + 1]! + 1 + weight(oldTokens[head + oldIndex]!) : Math.max(best[(oldIndex + 1) * width + newIndex]!, best[oldIndex * width + newIndex + 1]!);

  // each token of both lines, in order: kept by both, or only the old's or the new's
  type Op = { kind: "same" | "change" | "moved" | "gone"; oldText: string; newText: string; pairs?: ReadonlyArray<number> };
  const ops: Array<Op> = oldTokens.slice(0, head).map((token) => ({ kind: "same", oldText: token, newText: token }));
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldMiddle || newIndex < newMiddle) {
    const oldToken = oldTokens[head + oldIndex];
    const newToken = newTokens[head + newIndex];
    if (oldIndex < oldMiddle && newIndex < newMiddle && oldToken === newToken && best[oldIndex * width + newIndex] === best[(oldIndex + 1) * width + newIndex + 1]! + 1 + weight(oldToken!)) {
      ops.push({ kind: "same", oldText: oldToken!, newText: newToken! });
      oldIndex++;
      newIndex++;
    } else if (newIndex >= newMiddle || (oldIndex < oldMiddle && best[(oldIndex + 1) * width + newIndex]! >= best[oldIndex * width + newIndex + 1]!)) {
      ops.push({ kind: "change", oldText: oldToken!, newText: "" });
      oldIndex++;
    } else {
      ops.push({ kind: "change", oldText: "", newText: newToken! });
      newIndex++;
    }
  }
  ops.push(...oldTokens.slice(oldTokens.length - tail).map((token): Op => ({ kind: "same", oldText: token, newText: token })));

  // alike by what stayed in place: moves only change how a pair is drawn, so
  // a rewrite that happens to reuse words is not mistaken for a reorder
  const code = (parts: ReadonlyArray<string>) => parts.reduce((total, token) => total + weight(token), 0);
  const longer = Math.max(code(oldTokens), code(newTokens));
  const similarity = longer === 0 ? 0 : code(ops.filter((operation) => operation.kind === "same").map((operation) => operation.newText)) / longer;
  moves(ops);

  // runs of one kind each; a kept run of only whitespace between two
  // changes joins them, so they read as one
  const runs: Array<Op> = [];
  const join = (operation: Op) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === operation.kind) runs[runs.length - 1] = { kind: operation.kind, oldText: last.oldText + operation.oldText, newText: last.newText + operation.newText, pairs: [...(last.pairs ?? []), ...(operation.pairs ?? [])] };
    else runs.push({ ...operation });
  };
  ops.forEach(join);
  const joined = runs.splice(0);
  joined.forEach((run, position) => join(run.kind === "same" && joined[position - 1]?.kind === "change" && joined[position + 1]?.kind === "change" && blank(run.oldText) ? { ...run, kind: "change" } : run));

  // what the old line had there is removed, then what the new one has is
  // added; a move shows once, where it is now
  const segments: Array<Segment> = [];
  let oldAt = 0;
  let newAt = 0;
  for (const run of runs) {
    if (run.kind === "same") segments.push({ kind: "same", text: run.newText, at: newAt });
    else if (run.kind === "moved") segments.push({ kind: "moved", text: run.newText, at: newAt });
    else if (run.kind === "change") {
      // spacing alone (a line indented deeper, say) is not marked: an
      // underline under blanks reads as stray spaces; the ~ says it changed
      if (run.oldText && !blank(run.oldText)) segments.push({ kind: "removed", text: run.oldText, at: oldAt });
      if (run.newText) segments.push({ kind: blank(run.newText) ? "same" : "added", text: run.newText, at: newAt });
    }
    oldAt += run.oldText.length;
    newAt += run.newText.length;
  }

  // where each kept or moved word of the new line stood in the old one
  const olds = new Map<number, number>();
  let oldPlace = 0;
  for (const operation of ops) {
    if (operation.kind === "gone") for (const pair of operation.pairs ?? []) olds.set(pair, oldPlace);
    oldPlace += operation.oldText.length;
  }
  const map: Array<Was> = [];
  oldPlace = 0;
  let newPlace = 0;
  for (const operation of ops) {
    const from = operation.kind === "same" && operation.oldText === operation.newText ? oldPlace : operation.kind === "moved" ? olds.get(operation.pairs?.[0] ?? -1) : undefined;
    if (from !== undefined && operation.newText !== "") map.push({ now: newPlace, was: from, length: operation.newText.length });
    oldPlace += operation.oldText.length;
    newPlace += operation.newText.length;
  }

  // nothing but order changed: how much moved
  const movedWords = ops.filter((operation) => operation.kind === "moved" && word(operation.newText)).length;
  const otherwise = ops.some((operation) => operation.kind === "change" && (word(operation.oldText) || word(operation.newText)));
  const reorder = movedWords > 0 && !otherwise ? { moved: movedWords, words: newTokens.filter(word).length } : null;
  return { similarity, segments, map, reorder };
}

/** A word that can move: two characters or more, so a stray "a" or "i" is never a move. */
const word = (token: string) => token.length > 1 && /^[\p{L}\p{N}_$]/u.test(token);

/** Words a line lost in one place and gained in another are a move: the
 *  gained one is marked moved, the lost one left out. Only where moving
 *  explains at least as much of the line as everything else that changed in
 *  it — a reordered list, not a rewritten sentence that reuses a few words.
 *  Once anything moved, the punctuation and spacing the move shuffled (the
 *  commas and quotes of a reordered list) are matched the same way and read
 *  as kept. */
function moves(ops: Array<{ kind: string; oldText: string; newText: string; pairs?: ReadonlyArray<number> }>): void {
  const match = (pred: (t: string) => boolean) => {
    const left = ops.filter((operation) => operation.kind === "change" && operation.oldText !== "" && pred(operation.oldText));
    const found: Array<[gone: (typeof ops)[number], came: (typeof ops)[number]]> = [];
    for (const operation of ops) {
      if (operation.kind !== "change" || operation.newText === "" || !pred(operation.newText)) continue;
      const lostIndex = left.findIndex((lost) => lost.oldText === operation.newText);
      if (lostIndex >= 0) found.push([left.splice(lostIndex, 1)[0]!, operation]);
    }
    return found;
  };
  const words = match(word);
  const moved = words.reduce((total, [, came]) => total + weight(came.newText), 0);
  // words only: the commas and quotes a reorder shuffles are not other edits
  const wordWeight = (token: string) => (word(token) ? weight(token) : 0);
  const changed = ops.filter((operation) => operation.kind === "change").reduce((total, operation) => total + wordWeight(operation.oldText) + wordWeight(operation.newText), 0) - 2 * moved;
  if (moved === 0 || moved < changed) return;
  words.forEach(([gone, came], pairIndex) => {
    gone.kind = "gone";
    came.kind = "moved";
    gone.pairs = came.pairs = [pairIndex];
  });
  // the shuffled punctuation is not numbered: it reads as kept
  for (const [gone, came] of match((token) => !word(token))) {
    gone.kind = "gone";
    came.kind = "same";
  }
}

/** A hunk's lines as rows: in each run of removed lines followed by a run of
 *  added ones, the removed and added lines alike enough pair in order (the
 *  pairing that keeps the most in common), each pair one changed row; the
 *  rest stay removed and added lines, the removed above the added. */
export function rowsOf(lines: ReadonlyArray<DiffLine>): ReadonlyArray<Row> {
  const rows: Array<Row> = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index]!.kind !== "-") {
      rows.push({ line: lines[index]!, index });
      index++;
      continue;
    }
    const removedStart = index;
    while (index < lines.length && lines[index]!.kind === "-") index++;
    const addedStart = index;
    while (index < lines.length && lines[index]!.kind === "+") index++;
    // a line split over several keeps its words: those are set aside first,
    // and what lies between them pairs as before
    let removedFrom = removedStart;
    let addedFrom = addedStart;
    for (const split of splits(lines, removedStart, addedStart, index)) {
      rows.push(...paired(lines, removedFrom, split.removed, addedFrom, split.added));
      const old = lines[split.removed]!;
      const first = lines[split.added]!;
      rows.push({ line: first, index: split.added, was: { line: old, index: split.removed, segments: [{ kind: "same", text: first.text, at: 0 }], map: [], reorder: null } });
      for (let carried = split.added + 1; carried < split.added + split.into; carried++) rows.push({ line: lines[carried]!, index: carried, carries: true });
      removedFrom = split.removed + 1;
      addedFrom = split.added + split.into;
    }
    rows.push(...paired(lines, removedFrom, addedStart, addedFrom, index));
  }
  return rows;
}

/** Code alone: what a line says, its spacing aside. */
const codeOf = (text: string) => text.replace(/\s+/g, "");

/** In a run of removed lines [removedStart, addedStart) and the added lines
 *  after it [addedStart, end): each removed line whose code is, word for
 *  word, that of a few added lines in a row — split, not changed — in order. */
function splits(lines: ReadonlyArray<DiffLine>, removedStart: number, addedStart: number, end: number): Array<{ readonly removed: number; readonly added: number; readonly into: number }> {
  const found: Array<{ removed: number; added: number; into: number }> = [];
  let addedFrom = addedStart;
  for (let removed = removedStart; removed < addedStart; removed++) {
    const old = codeOf(lines[removed]!.text);
    if (old.length < SPLIT_CODE) continue;
    search: for (let added = addedFrom; added < end; added++) {
      let joined = "";
      for (let into = 1; into <= SPLIT_INTO && added + into <= end; into++) {
        const part = codeOf(lines[added + into - 1]!.text);
        if (part === "") break;
        joined += part;
        if (!old.startsWith(joined)) break;
        if (joined === old && into > 1) {
          found.push({ removed, added, into });
          addedFrom = added + into;
          break search;
        }
      }
    }
  }
  return found;
}

/** Removed lines [removedStart, removedEnd) and added lines [addedStart, addedEnd), paired. */
function paired(lines: ReadonlyArray<DiffLine>, removedStart: number, removedEnd: number, addedStart: number, addedEnd: number): Array<Row> {
  const removedCount = removedEnd - removedStart;
  const addedCount = addedEnd - addedStart;
  // a rewrite of thousands of lines is read as removed and added
  if (removedCount * addedCount > MAX_RUN_CELLS)
    return [...lines.slice(removedStart, removedEnd).map((line, offset) => ({ line, index: removedStart + offset })), ...lines.slice(addedStart, addedEnd).map((line, offset) => ({ line, index: addedStart + offset }))];
  const diffs = new Map<number, Diff>();
  const at = (removedIndex: number, addedIndex: number) => removedIndex * (addedCount + 1) + addedIndex;
  // best[removedIndex,addedIndex]: the most similarity pairing the removed lines from removedIndex on with the added from addedIndex on can keep
  const best = new Float64Array((removedCount + 1) * (addedCount + 1));
  for (let removedIndex = removedCount - 1; removedIndex >= 0; removedIndex--)
    for (let addedIndex = addedCount - 1; addedIndex >= 0; addedIndex--) {
      let pair = -1;
      if (Math.abs(removedIndex - addedIndex) <= BAND) {
        const diff = alike(lines[removedStart + removedIndex]!.text, lines[addedStart + addedIndex]!.text);
        if (diff) {
          diffs.set(at(removedIndex, addedIndex), diff);
          pair = best[at(removedIndex + 1, addedIndex + 1)]! + diff.similarity;
        }
      }
      best[at(removedIndex, addedIndex)] = Math.max(pair, best[at(removedIndex + 1, addedIndex)]!, best[at(removedIndex, addedIndex + 1)]!);
    }
  const rows: Array<Row> = [];
  let removedIndex = 0;
  let addedIndex = 0;
  let restRemoved = 0;
  let restAdded = 0;
  const rest = (toI: number, toJ: number) => {
    for (; restRemoved < toI; restRemoved++) rows.push({ line: lines[removedStart + restRemoved]!, index: removedStart + restRemoved });
    for (; restAdded < toJ; restAdded++) rows.push({ line: lines[addedStart + restAdded]!, index: addedStart + restAdded });
  };
  while (removedIndex < removedCount && addedIndex < addedCount) {
    const diff = diffs.get(at(removedIndex, addedIndex));
    if (diff && best[at(removedIndex, addedIndex)] === best[at(removedIndex + 1, addedIndex + 1)]! + diff.similarity) {
      rest(removedIndex, addedIndex);
      rows.push({ line: lines[addedStart + addedIndex]!, index: addedStart + addedIndex, was: { line: lines[removedStart + removedIndex]!, index: removedStart + removedIndex, segments: diff.segments, map: diff.map, reorder: diff.reorder } });
      restRemoved = ++removedIndex;
      restAdded = ++addedIndex;
    } else if (best[at(removedIndex + 1, addedIndex)] === best[at(removedIndex, addedIndex)]) removedIndex++;
    else addedIndex++;
  }
  rest(removedCount, addedCount);
  return rows;
}

/** Two lines' word diff when they are alike enough to read as one. */
function alike(old: string, now: string): Diff | null {
  const code = (text: string) => text.replace(/\s+/g, "").length;
  const [oldCode, newCode] = [code(old), code(now)];
  // even sharing all of the shorter, the longer would be mostly new
  if (Math.min(oldCode, newCode) < SIMILAR * Math.max(oldCode, newCode)) return null;
  const diff = wordDiff(old, now);
  return diff && diff.similarity >= SIMILAR ? diff : null;
}

/** A line's coloured spans between two offsets, each with where it starts —
 *  how a segment takes its colour from the line it came from. Spans that do
 *  not cover the line's text are not trusted: the text is taken plain. */
export function spansIn(spans: ReadonlyArray<Span>, text: string, from: number, to: number): Array<{ readonly span: Span; readonly at: number }> {
  const all = spans.reduce((total, span) => total + span.value.length, 0) === text.length ? spans : [{ value: text }];
  const out: Array<{ span: Span; at: number }> = [];
  let offset = 0;
  for (const span of all) {
    const start = Math.max(offset, from);
    const end = Math.min(offset + span.value.length, to);
    if (start < end) out.push({ span: { ...span, value: span.value.slice(start - offset, end - offset) }, at: start });
    offset += span.value.length;
  }
  return out;
}
