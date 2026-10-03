import { createSignal } from "solid-js";
import type { Hunk } from "./data";
import { addedLines } from "./whole";

// What this page's diff adds, file by file, and whether the branch can be
// read whole here (a clone of it on this machine) — set by the page when its
// data comes in, read by every hunk.
const [added, setAdded] = createSignal<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
const [readable, setReadable] = createSignal(false);

export const diffNow = {
  addedIn: (file: string): ReadonlySet<number> => added().get(file) ?? new Set(),
  canReadWhole: readable,
  set: (hunks: ReadonlyArray<Hunk>, fromClone: boolean) => {
    setAdded(addedLines(hunks));
    setReadable(fromClone);
  },
};
