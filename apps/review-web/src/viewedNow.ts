import { createSignal } from "solid-js";
import { ticketId } from "./ticket";
import { viewedStore } from "./viewed";

/** This page's marks: one review, one store. */
export const viewed = viewedStore(ticketId);

// A file marked viewed folds, as on GitHub — and, as there, it can be opened
// again to read without taking the mark back: the mark says it was read, not
// that it is hidden. Which viewed files are open again, for this page view.
const [reopened, setReopened] = createSignal<ReadonlySet<string>>(new Set());
// Files being marked right now, their code folding away: the mark lands once
// the fold has, but what closes with the file (its unit's why) starts with it.
const [folding, setFolding] = createSignal<ReadonlySet<string>>(new Set());

export const reading = {
  /** Folded: marked viewed and not opened again. */
  folded: (file: string): boolean => viewed.state(file) === "viewed" && !reopened().has(file),
  /** Being marked: its code folding away, the mark to come. */
  folding: (file: string): boolean => folding().has(file),
  /** A file's fold begins, or (false) has landed. */
  foldsNow: (file: string, now: boolean): void => {
    setFolding((files) => {
      if (files.has(file) === now) return files;
      const next = new Set(files);
      if (now) next.add(file);
      else next.delete(file);
      return next;
    });
  },
  /** Open a viewed file again, or fold it back. */
  toggle: (file: string): void => {
    setReopened((files) => {
      const next = new Set(files);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  },
  /** The mark changed: a file newly marked folds, whatever it was before. */
  marked: (file: string): void => {
    setReopened((files) => {
      if (!files.has(file)) return files;
      const next = new Set(files);
      next.delete(file);
      return next;
    });
  },
};
