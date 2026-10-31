import { createSignal } from "solid-js";
import type { Hunk } from "./data";
import { setViewed } from "./api";
import { lasting } from "./lasting";
import { overSocket } from "./liveSocket";
import { fingerprints, viewedState, type Mark, type Marks, type Viewed } from "./marks";

export { fingerprint, fingerprints, readMarks, viewedState, type Mark, type Viewed } from "./marks";

// Files marked as read, as GitHub's "viewed": a file the reader has been
// through folds away wherever it shows on the page, and a count says what
// is left. A mark is for the file as it was read — when its changes move
// (the author pushed again) it opens and says it changed since. Kept by the
// reader's own collagen, per review: their agent reads and makes the same
// marks (review-progress), they outlast a browser, and they never go to the
// room — the reader's place in a review is theirs.

/** The page's marks for one review: collagen's, live; a change shows at
 *  once and is kept there, which tells every open page. */
export const viewedStore = (ticketId: string) => {
  const [marks, setMarks] = createSignal<Marks>({});
  const [now, setNow] = createSignal<ReadonlyMap<string, string>>(new Map());
  const state = (file: string): Viewed => viewedState(marks(), file, now().get(file));
  void (async () => {
    for await (const kept of lasting(() => overSocket("viewed", ticketId))) setMarks(kept);
  })();
  /** marked, or marked again: as it is now, at the branch's commit now */
  const toggle = (file: string, commit: string | undefined) => {
    const next: Record<string, Mark> = { ...marks() };
    const fingerprintNow = now().get(file);
    let mark: Mark | null = null;
    if (state(file) === "viewed") delete next[file];
    // never a mark without what the file was: it could only ever read "changed"
    else if (fingerprintNow) next[file] = mark = { fp: fingerprintNow, ...(commit ? { at: commit } : {}) };
    else return;
    setMarks(next);
    void setViewed(ticketId, file, mark).catch(() => undefined);
  };
  /** marked as it is now, whatever it was — a group of uses marked at once */
  const mark = (file: string, commit: string | undefined) => {
    if (state(file) === "viewed") return;
    toggle(file, commit);
  };
  const count = () => {
    const files = [...now().keys()];
    return { viewed: files.filter((file) => state(file) === "viewed").length, files: files.length };
  };
  /** the commit a file was viewed at, when the page knew it */
  const viewedAt = (file: string): string | undefined => marks()[file]?.at;
  // the diff's files read at least once: before that a count of none means "not yet", not "none"
  const [read, setRead] = createSignal(false);
  const setFiles = (hunks: ReadonlyArray<Hunk>) => {
    setNow(fingerprints(hunks));
    setRead(true);
  };
  return { state, toggle, mark, count, viewedAt, read, setFiles };
};
