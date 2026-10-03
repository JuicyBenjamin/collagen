import { createSignal } from "solid-js";
import type { Hunk } from "./data";
import { addedLines } from "./whole";

// What this page's diff adds, file by file, and whether the branch can be
// read whole here (a clone of it on this machine) — set by the page when its
// data comes in, read by every hunk.
const [added, setAdded] = createSignal<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
const [readable, setReadable] = createSignal(false);
const [commit, setCommit] = createSignal<string | undefined>(undefined);
const [byFile, setByFile] = createSignal<ReadonlyMap<string, ReadonlyArray<Hunk>>>(new Map());

export const diffNow = {
  addedIn: (file: string): ReadonlySet<number> => added().get(file) ?? new Set(),
  canReadWhole: readable,
  /** the branch's commit the diff was read at (from a clone) */
  commit,
  /** a file's hunks, in diff order */
  hunksOf: (file: string): ReadonlyArray<Hunk> => byFile().get(file) ?? [],
  set: (hunks: ReadonlyArray<Hunk>, fromClone: boolean, at: string | undefined) => {
    setAdded(addedLines(hunks));
    setReadable(fromClone);
    setCommit(at);
    const m = new Map<string, Array<Hunk>>();
    for (const h of hunks) m.set(h.file, [...(m.get(h.file) ?? []), h]);
    setByFile(m);
  },
};
