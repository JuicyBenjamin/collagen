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

/** A file's state: marked as it is now, marked as it was before, or not. */
export const viewedState = (marks: Readonly<Record<string, string>>, file: string, now: string | undefined): Viewed =>
  marks[file] === undefined ? "unread" : marks[file] === now ? "viewed" : "changed";

const key = (ticketId: string) => `collagen.viewed.${ticketId}`;

const load = (ticketId: string): Record<string, string> => {
  try {
    const raw = localStorage.getItem(key(ticketId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

/** The page's marks for one review: read once, written on every change. */
export const viewedStore = (ticketId: string) => {
  const [marks, setMarks] = createSignal<Record<string, string>>(load(ticketId));
  const [now, setNow] = createSignal<ReadonlyMap<string, string>>(new Map());
  const state = (file: string): Viewed => viewedState(marks(), file, now().get(file));
  const toggle = (file: string) => {
    const next = { ...marks() };
    if (state(file) === "viewed") delete next[file];
    else next[file] = now().get(file) ?? "";
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
  return { state, toggle, count, setFiles: (hunks: ReadonlyArray<Hunk>) => setNow(fingerprints(hunks)) };
};
