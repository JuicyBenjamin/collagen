import type { Hunk } from "./data";

// Viewed marks as values: what a file's changes are, a mark made of that,
// and what a mark says now. Pure, so collagen reads them as the page does —
// for the person's agent (review-progress) as much as for the page.

/** What a file's changes are, in a few characters: every line of every
 *  hunk of it, so a push that touches the file gives it a new one. */
export const fingerprint = (hunks: ReadonlyArray<Hunk>): string => {
  let hash = 5381;
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      const text = `${line.kind}${line.text}\n`;
      for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
    }
  return (hash >>> 0).toString(36);
};

/** Each file of the diff and its fingerprint. */
export const fingerprints = (hunks: ReadonlyArray<Hunk>): ReadonlyMap<string, string> => {
  const byFile = new Map<string, Array<Hunk>>();
  for (const hunk of hunks) byFile.set(hunk.file, [...(byFile.get(hunk.file) ?? []), hunk]);
  return new Map([...byFile].map(([file, fileHunks]) => [file, fingerprint(fileHunks)]));
};

export type Viewed = "viewed" | "changed" | "unread";

/** A mark: the file's fingerprint when it was read, and the branch's commit
 *  then (from a clone), to show what moved since. */
export interface Mark {
  // oxlint-disable-next-line naming/no-shorthand-names -- kept by collagen as `fp`
  readonly fp: string;
  readonly at?: string;
}
export type Marks = Readonly<Record<string, Mark>>;

/** A file's state: marked as it is now, marked as it was before, or not.
 *  "Changed" needs both ends: a mark with a real fingerprint, and the file's
 *  fingerprint now. A mark made blind, or a file the page has none for yet,
 *  is unread — never a change the reader did not see. */
export const viewedState = (marks: Marks, file: string, now: string | undefined): Viewed => {
  const mark = marks[file];
  if (!mark?.fp || now === undefined) return "unread";
  return mark.fp === now ? "viewed" : "changed";
};

/** Marks as stored — the first ones kept the fingerprint alone. */
export const readMarks = (raw: unknown): Marks => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Mark> = {};
  for (const [file, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[file] = { fp: value };
    else if (value && typeof value === "object" && typeof (value as Mark).fp === "string") out[file] = { fp: (value as Mark).fp, ...(typeof (value as Mark).at === "string" ? { at: (value as Mark).at } : {}) };
  }
  return out;
};
