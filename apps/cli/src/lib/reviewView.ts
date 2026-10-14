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
  let hunkIndex = 0;
  interface Open {
    file: string;
    header: string;
    newStart: number;
    newLines: number;
    lines: Array<DiffLine>;
    /** next old / new line number */
    nextOld: number;
    nextNew: number;
  }
  let open: Open | null = null;
  const flush = () => {
    if (!open) return;
    out.push({ id: `${open.file}#${hunkIndex++}`, file: open.file, header: open.header, newStart: open.newStart, newLines: open.newLines, lines: open.lines });
    open = null;
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
      const path = raw.slice(4);
      file = path === "/dev/null" ? oldFile : path.replace(/^b\//, "");
      continue;
    }
    const match = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (match) {
      flush();
      open = { file, header: raw, newStart: Number(match[3]), newLines: match[4] === undefined ? 1 : Number(match[4]), lines: [], nextOld: Number(match[1]), nextNew: Number(match[3]) };
      continue;
    }
    if (!open) continue;
    const hunk: Open = open;
    if (raw.startsWith("+")) hunk.lines.push({ kind: "+", text: raw.slice(1), new: hunk.nextNew++ });
    else if (raw.startsWith("-")) hunk.lines.push({ kind: "-", text: raw.slice(1), old: hunk.nextOld++ });
    else if (raw.startsWith(" ") || raw === "") hunk.lines.push({ kind: " ", text: raw.slice(1), old: hunk.nextOld++, new: hunk.nextNew++ });
    // "\ No newline at end of file" and anything else: not a line of code
  }
  flush();
  // the empty string after the diff's final "\n" is the split's, not a line
  // of code: drop it where it made a hunk longer than its header says
  return out.map((hunk) => {
    const last = hunk.lines[hunk.lines.length - 1];
    const count = hunk.lines.filter((line) => line.kind !== "-").length;
    return last && last.kind === " " && last.text === "" && count > hunk.newLines ? { ...hunk, lines: hunk.lines.slice(0, -1) } : hunk;
  });
}

export interface Pointer {
  readonly file: string;
  /** first line pointed at, when the pointer has one */
  readonly line?: number;
  readonly end?: number;
}

/** "src/x.ts:12", "src/x.ts:12-20", "src/x.ts" — the forms an agent writes. */
export function parsePointer(text: string): Pointer {
  const match = text.trim().match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!match) return { file: text.trim() };
  return { file: match[1]!, line: Number(match[2]), ...(match[3] ? { end: Number(match[3]) } : {}) };
}

/** Paths in a why are written however the agent saw them — from the repo
 *  root, from a package, with the project's own folder in front. Two paths
 *  are the same file when one ends with the other on a segment boundary. */
export const sameFile = (path: string, other: string): boolean => {
  const plain = path.replace(/^\.\//, "");
  const plainOther = other.replace(/^\.\//, "");
  return plain === plainOther || plain.endsWith(`/${plainOther}`) || plainOther.endsWith(`/${plain}`);
};

/** How far outside a hunk a pointed-at line may sit and still mean it: the
 *  agent names the line it wrote, git frames it with context, and a line
 *  number recorded before a later edit drifts by a few. */
const NEAR = 10;

/** The hunks a pointer claims: in its file, the one holding its line (or
 *  range), else the nearest within NEAR lines; every hunk of the file when
 *  it names a file alone. */
export function claimed(pointer: Pointer, hunks: ReadonlyArray<Hunk>): ReadonlyArray<Hunk> {
  const inFile = hunks.filter((hunk) => sameFile(hunk.file, pointer.file));
  if (pointer.line === undefined) return inFile;
  const firstLine = pointer.line;
  const lastLine = pointer.end ?? pointer.line;
  const hit = inFile.filter((hunk) => firstLine <= hunk.newStart + Math.max(hunk.newLines, 1) - 1 && lastLine >= hunk.newStart);
  if (hit.length > 0) return hit;
  const dist = (hunk: Hunk) => Math.max(hunk.newStart - lastLine, firstLine - (hunk.newStart + Math.max(hunk.newLines, 1) - 1), 0);
  const near = inFile.filter((hunk) => dist(hunk) <= NEAR).sort((a, b) => dist(a) - dist(b));
  return near.slice(0, 1);
}
