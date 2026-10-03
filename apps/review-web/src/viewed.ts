import { createSignal } from "solid-js";
import type { Hunk } from "./data";

// Files marked as read, as GitHub's "viewed": a file the reader has been
// through folds away wherever it shows on the page, and a count says what
// is left. A mark is for the file as it was read — when its changes move
// (the author pushed again) it opens and says it changed since. Kept in
// this browser, per review: it is the reader's place in the page, not
// something anyone else needs.

/** What a file's changes are, in a few characters: every line of every
 *  hunk of it, so a push that touches the file gives it a new one. */
export const fingerprint = (hunks: ReadonlyArray<Hunk>): string => {
  let h = 5381;
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      const s = `${line.kind}${line.text}\n`;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
  return (h >>> 0).toString(36);
};

/** Each file of the diff and its fingerprint. */
export const fingerprints = (hunks: ReadonlyArray<Hunk>): ReadonlyMap<string, string> => {
  const byFile = new Map<string, Array<Hunk>>();
  for (const h of hunks) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
  return new Map([...byFile].map(([file, hs]) => [file, fingerprint(hs)]));
};

export type Viewed = "viewed" | "changed" | "unread";

/** A mark: the file's fingerprint when it was read, and the branch's commit
 *  then (from a clone), to show what moved since. */
export interface Mark {
  readonly fp: string;
  readonly at?: string;
}
type Marks = Readonly<Record<string, Mark>>;

/** A file's state: marked as it is now, marked as it was before, or not. */
export const viewedState = (marks: Marks, file: string, now: string | undefined): Viewed =>
  marks[file] === undefined ? "unread" : marks[file]!.fp === now ? "viewed" : "changed";

/** Marks as stored — the first ones kept the fingerprint alone. */
export const readMarks = (raw: unknown): Marks => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Mark> = {};
  for (const [file, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[file] = { fp: v };
    else if (v && typeof v === "object" && typeof (v as Mark).fp === "string") out[file] = { fp: (v as Mark).fp, ...(typeof (v as Mark).at === "string" ? { at: (v as Mark).at } : {}) };
  }
  return out;
};

const key = (ticketId: string) => `collagen.viewed.${ticketId}`;

const load = (ticketId: string): Marks => {
  try {
    const raw = localStorage.getItem(key(ticketId));
    return readMarks(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
};

/** The page's marks for one review: read once, written on every change. */
export const viewedStore = (ticketId: string) => {
  const [marks, setMarks] = createSignal<Marks>(load(ticketId));
  const [now, setNow] = createSignal<ReadonlyMap<string, string>>(new Map());
  const state = (file: string): Viewed => viewedState(marks(), file, now().get(file));
  /** marked, or marked again: as it is now, at the branch's commit now */
  const toggle = (file: string, commit: string | undefined) => {
    const next: Record<string, Mark> = { ...marks() };
    if (state(file) === "viewed") delete next[file];
    else next[file] = { fp: now().get(file) ?? "", ...(commit ? { at: commit } : {}) };
    setMarks(next);
    try {
      localStorage.setItem(key(ticketId), JSON.stringify(next));
    } catch {
      // private window, storage off: the mark lasts the page, not the browser
    }
  };
  const count = () => {
    const files = [...now().keys()];
    return { viewed: files.filter((f) => state(f) === "viewed").length, files: files.length };
  };
  /** the commit a file was viewed at, when the page knew it */
  const viewedAt = (file: string): string | undefined => marks()[file]?.at;
  return { state, toggle, count, viewedAt, setFiles: (hunks: ReadonlyArray<Hunk>) => setNow(fingerprints(hunks)) };
};
