import type { DiffLine } from "./data";
import type { Span } from "./highlight";

// A line changed in place, read as one line: a removed line and the added
// line that took its place are paired, and their words diffed, so the
// reader sees what was added and what was taken away instead of reading two
// whole lines to find it. Done at render time from a hunk's lines; the diff
// the server sends is untouched.

export interface Segment {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
  /** where it starts in its own line: the old one for removed, else the new */
  readonly at: number;
}

/** A row as drawn: a line of the diff, or — `was` set — an added line that
 *  took the place of a removed one, both numbers on one row. `index` is the
 *  line's place in the hunk's lines. */
export interface Row {
  readonly line: DiffLine;
  readonly index: number;
  readonly was?: { readonly line: DiffLine; readonly index: number; readonly segments: ReadonlyArray<Segment> };
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

const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^]/gu;
const tokens = (s: string): Array<string> => s.match(TOKEN) ?? [];
const blank = (t: string) => /^\s+$/.test(t);
const weight = (t: string) => (blank(t) ? 0 : t.length);

interface Diff {
  /** shared code over the longer line's code */
  readonly similarity: number;
  readonly segments: ReadonlyArray<Segment>;
}

/** Two lines diffed by word: identifiers and numbers, runs of whitespace,
 *  single punctuation. Null when they are too long to weigh. */
export function wordDiff(old: string, now: string): Diff | null {
  const a = tokens(old);
  const b = tokens(now);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n * m > MAX_CELLS) return null;

  // longest common subsequence of the middles, by code weight
  const w = m + 1;
  const best = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      best[i * w + j] = a[head + i] === b[head + j] ? best[(i + 1) * w + j + 1]! + 1 + weight(a[head + i]!) : Math.max(best[(i + 1) * w + j]!, best[i * w + j + 1]!);

  // each token of both lines, in order: kept by both, or only the old's or the new's
  type Op = { same: boolean; a: string; b: string };
  const ops: Array<Op> = a.slice(0, head).map((t) => ({ same: true, a: t, b: t }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const ta = a[head + i];
    const tb = b[head + j];
    if (i < n && j < m && ta === tb && best[i * w + j] === best[(i + 1) * w + j + 1]! + 1 + weight(ta!)) {
      ops.push({ same: true, a: ta!, b: tb! });
      i++;
      j++;
    } else if (j >= m || (i < n && best[(i + 1) * w + j]! >= best[i * w + j + 1]!)) {
      ops.push({ same: false, a: ta!, b: "" });
      i++;
    } else {
      ops.push({ same: false, a: "", b: tb! });
      j++;
    }
  }
  ops.push(...a.slice(a.length - tail).map((t) => ({ same: true, a: t, b: t })));

  const code = (ts: ReadonlyArray<string>) => ts.reduce((s, t) => s + weight(t), 0);
  const longer = Math.max(code(a), code(b));
  const similarity = longer === 0 ? 0 : code(ops.filter((o) => o.same).map((o) => o.a)) / longer;

  // runs of kept and of changed tokens, alternating; a kept run of only
  // whitespace between two changes joins them, so they read as one
  const runs: Array<Op> = [];
  const join = (o: Op) => {
    const last = runs[runs.length - 1];
    if (last && last.same === o.same) runs[runs.length - 1] = { same: o.same, a: last.a + o.a, b: last.b + o.b };
    else runs.push({ ...o });
  };
  ops.forEach(join);
  const joined = runs.splice(0);
  joined.forEach((r, k) => join(r.same && k > 0 && k < joined.length - 1 && blank(r.a) ? { ...r, same: false } : r));

  // what the old line had there is removed, then what the new one has is added
  const segments: Array<Segment> = [];
  let oa = 0;
  let ob = 0;
  for (const r of runs) {
    if (r.same) segments.push({ kind: "same", text: r.b, at: ob });
    else {
      if (r.a) segments.push({ kind: "removed", text: r.a, at: oa });
      if (r.b) segments.push({ kind: "added", text: r.b, at: ob });
    }
    oa += r.a.length;
    ob += r.b.length;
  }
  return { similarity, segments };
}

/** A hunk's lines as rows: in each run of removed lines followed by a run of
 *  added ones, the removed and added lines alike enough pair in order (the
 *  pairing that keeps the most in common), each pair one changed row; the
 *  rest stay removed and added lines, the removed above the added. */
export function rowsOf(lines: ReadonlyArray<DiffLine>): ReadonlyArray<Row> {
  const rows: Array<Row> = [];
  let k = 0;
  while (k < lines.length) {
    if (lines[k]!.kind !== "-") {
      rows.push({ line: lines[k]!, index: k });
      k++;
      continue;
    }
    const r0 = k;
    while (k < lines.length && lines[k]!.kind === "-") k++;
    const a0 = k;
    while (k < lines.length && lines[k]!.kind === "+") k++;
    rows.push(...paired(lines, r0, a0, k));
  }
  return rows;
}

/** One run of removed lines [r0, a0) and the added lines after it [a0, end). */
function paired(lines: ReadonlyArray<DiffLine>, r0: number, a0: number, end: number): Array<Row> {
  const n = a0 - r0;
  const m = end - a0;
  // a rewrite of thousands of lines is read as removed and added
  if (n * m > MAX_RUN_CELLS) return lines.slice(r0, end).map((line, k) => ({ line, index: r0 + k }));
  const diffs = new Map<number, Diff>();
  const at = (i: number, j: number) => i * (m + 1) + j;
  // best[i,j]: the most similarity pairing removed i.. with added j.. can keep
  const best = new Float64Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      let pair = -1;
      if (Math.abs(i - j) <= BAND) {
        const d = alike(lines[r0 + i]!.text, lines[a0 + j]!.text);
        if (d) {
          diffs.set(at(i, j), d);
          pair = best[at(i + 1, j + 1)]! + d.similarity;
        }
      }
      best[at(i, j)] = Math.max(pair, best[at(i + 1, j)]!, best[at(i, j + 1)]!);
    }
  const rows: Array<Row> = [];
  let i = 0;
  let j = 0;
  let ri = 0;
  let aj = 0;
  const rest = (toI: number, toJ: number) => {
    for (; ri < toI; ri++) rows.push({ line: lines[r0 + ri]!, index: r0 + ri });
    for (; aj < toJ; aj++) rows.push({ line: lines[a0 + aj]!, index: a0 + aj });
  };
  while (i < n && j < m) {
    const d = diffs.get(at(i, j));
    if (d && best[at(i, j)] === best[at(i + 1, j + 1)]! + d.similarity) {
      rest(i, j);
      rows.push({ line: lines[a0 + j]!, index: a0 + j, was: { line: lines[r0 + i]!, index: r0 + i, segments: d.segments } });
      ri = ++i;
      aj = ++j;
    } else if (best[at(i + 1, j)] === best[at(i, j)]) i++;
    else j++;
  }
  rest(n, m);
  return rows;
}

/** Two lines' word diff when they are alike enough to read as one. */
function alike(old: string, now: string): Diff | null {
  const code = (s: string) => s.replace(/\s+/g, "").length;
  const [x, y] = [code(old), code(now)];
  // even sharing all of the shorter, the longer would be mostly new
  if (Math.min(x, y) < SIMILAR * Math.max(x, y)) return null;
  const d = wordDiff(old, now);
  return d && d.similarity >= SIMILAR ? d : null;
}

/** A line's coloured spans between two offsets, each with where it starts —
 *  how a segment takes its colour from the line it came from. Spans that do
 *  not cover the line's text are not trusted: the text is taken plain. */
export function spansIn(spans: ReadonlyArray<Span>, text: string, from: number, to: number): Array<{ readonly span: Span; readonly at: number }> {
  const all = spans.reduce((n, s) => n + s.value.length, 0) === text.length ? spans : [{ value: text }];
  const out: Array<{ span: Span; at: number }> = [];
  let o = 0;
  for (const s of all) {
    const start = Math.max(o, from);
    const end = Math.min(o + s.value.length, to);
    if (start < end) out.push({ span: { ...s, value: s.value.slice(start - o, end - o) }, at: start });
    o += s.value.length;
  }
  return out;
}
