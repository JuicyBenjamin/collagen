import { createSignal } from "solid-js";
import type { Hunk } from "./data";
import type { DiffLine } from "./data";
import { addedLines, removedLines } from "./whole";

// What this page's diff adds, file by file, and whether the branch can be
// read whole here (a clone of it on this machine) — set by the page when its
// data comes in, read by every hunk.
const [added, setAdded] = createSignal<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
const [removed, setRemoved] = createSignal<ReadonlyMap<string, ReadonlyMap<number, ReadonlyArray<DiffLine>>>>(new Map());
const [readable, setReadable] = createSignal(false);
const [commit, setCommit] = createSignal<string | undefined>(undefined);
const [byFile, setByFile] = createSignal<ReadonlyMap<string, ReadonlyArray<Hunk>>>(new Map());

export const diffNow = {
  addedIn: (file: string): ReadonlySet<number> => added().get(file) ?? new Set(),
  /** what the diff removes from a file, by the new line it stood before */
  removedIn: (file: string): ReadonlyMap<number, ReadonlyArray<DiffLine>> => removed().get(file) ?? new Map(),
  canReadWhole: readable,
  /** the branch's commit the diff was read at (from a clone) */
  commit,
  /** a file's hunks, in diff order */
  hunksOf: (file: string): ReadonlyArray<Hunk> => byFile().get(file) ?? [],
  set: (hunks: ReadonlyArray<Hunk>, fromClone: boolean, at: string | undefined) => {
    setAdded(addedLines(hunks));
    setRemoved(removedLines(hunks));
    setReadable(fromClone);
    setCommit(at);
    const hunksByFile = new Map<string, Array<Hunk>>();
    for (const hunk of hunks) hunksByFile.set(hunk.file, [...(hunksByFile.get(hunk.file) ?? []), hunk]);
    setByFile(hunksByFile);
  },
};
