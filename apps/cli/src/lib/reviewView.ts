import type { DiffLine, Hunk } from "@collagen/review-web/data";

export type { DiffLine, Grouped, Hunk, Unit } from "@collagen/review-web/data";

// A review read by intent, not by filename. A diff in file order spreads one
// decision over a dozen places and puts unrelated ones side by side — worse
// when an agent wrote the code. The review's why already carries the key to
// regroup it: every decision names `where` it landed (file:line), every fork
// `at` (file:line), every unit the code it holds. This is the pure half of
// the review page: parse the diff the reviewer's own clone produced, and
// read the pointers that claim its hunks (lib/units lays them out). No model in the reader's seat, no code copied
// anywhere — git is the source of truth (services/ReviewView).

/** Parse `git diff` unified output into hunks. Binary files and pure
 *  renames have no hunks and so do not appear. */
export function parseDiff(text: string): ReadonlyArray<Hunk> {
  const out: Array<Hunk> = [];
  let file = "";
  let oldFile = "";
  let n = 0;
  interface Open {
    file: string;
    header: string;
    newStart: number;
    newLines: number;
    lines: Array<DiffLine>;
    /** next old / new line number */
    o: number;
    w: number;
  }
  let cur: Open | null = null;
  const flush = () => {
    if (!cur) return;
    out.push({ id: `${cur.file}#${n++}`, file: cur.file, header: cur.header, newStart: cur.newStart, newLines: cur.newLines, lines: cur.lines });
    cur = null;
  };
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      flush();
      file = "";
      oldFile = "";
      continue;
    }
    if (raw.startsWith("--- ")) {
      oldFile = raw.slice(4).replace(/^a\//, "");
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      file = p === "/dev/null" ? oldFile : p.replace(/^b\//, "");
      continue;
    }
    const h = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (h) {
      flush();
      cur = { file, header: raw, newStart: Number(h[3]), newLines: h[4] === undefined ? 1 : Number(h[4]), lines: [], o: Number(h[1]), w: Number(h[3]) };
      continue;
    }
    if (!cur) continue;
    const c: Open = cur;
    if (raw.startsWith("+")) c.lines.push({ kind: "+", text: raw.slice(1), new: c.w++ });
    else if (raw.startsWith("-")) c.lines.push({ kind: "-", text: raw.slice(1), old: c.o++ });
    else if (raw.startsWith(" ") || raw === "") c.lines.push({ kind: " ", text: raw.slice(1), old: c.o++, new: c.w++ });
    // "\ No newline at end of file" and anything else: not a line of code
  }
  flush();
  // the empty string after the diff's final "\n" is the split's, not a line
  // of code: drop it where it made a hunk longer than its header says
  return out.map((h) => {
    const last = h.lines[h.lines.length - 1];
    const count = h.lines.filter((l) => l.kind !== "-").length;
    return last && last.kind === " " && last.text === "" && count > h.newLines ? { ...h, lines: h.lines.slice(0, -1) } : h;
  });
}

export interface Pointer {
  readonly file: string;
  /** first line pointed at, when the pointer has one */
  readonly line?: number;
  readonly end?: number;
}

/** "src/x.ts:12", "src/x.ts:12-20", "src/x.ts" — the forms an agent writes. */
export function parsePointer(s: string): Pointer {
  const m = s.trim().match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!m) return { file: s.trim() };
  return { file: m[1]!, line: Number(m[2]), ...(m[3] ? { end: Number(m[3]) } : {}) };
}

/** Paths in a why are written however the agent saw them — from the repo
 *  root, from a package, with the project's own folder in front. Two paths
 *  are the same file when one ends with the other on a segment boundary. */
export const sameFile = (a: string, b: string): boolean => {
  const x = a.replace(/^\.\//, "");
  const y = b.replace(/^\.\//, "");
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
};

/** How far outside a hunk a pointed-at line may sit and still mean it: the
 *  agent names the line it wrote, git frames it with context, and a line
 *  number recorded before a later edit drifts by a few. */
const NEAR = 10;

/** The hunks a pointer claims: in its file, the one holding its line (or
 *  range), else the nearest within NEAR lines; every hunk of the file when
 *  it names a file alone. */
export function claimed(p: Pointer, hunks: ReadonlyArray<Hunk>): ReadonlyArray<Hunk> {
  const inFile = hunks.filter((h) => sameFile(h.file, p.file));
  if (p.line === undefined) return inFile;
  const lo = p.line;
  const hi = p.end ?? p.line;
  const hit = inFile.filter((h) => lo <= h.newStart + Math.max(h.newLines, 1) - 1 && hi >= h.newStart);
  if (hit.length > 0) return hit;
  const dist = (h: Hunk) => Math.max(h.newStart - hi, lo - (h.newStart + Math.max(h.newLines, 1) - 1), 0);
  const near = inFile.filter((h) => dist(h) <= NEAR).sort((a, b) => dist(a) - dist(b));
  return near.slice(0, 1);
}
