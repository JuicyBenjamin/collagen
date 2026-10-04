import { createSignal } from "solid-js";
import { ticketId } from "./ticket";
import { viewedStore } from "./viewed";

/** This page's marks: one review, one store. */
export const viewed = viewedStore(ticketId);

// A file marked viewed folds, as on GitHub — and, as there, it can be opened
// again to read without taking the mark back: the mark says it was read, not
// that it is hidden. Which viewed files are open again, for this page view.
const [reopened, setReopened] = createSignal<ReadonlySet<string>>(new Set());

export const reading = {
  /** Folded: marked viewed and not opened again. */
  folded: (file: string): boolean => viewed.state(file) === "viewed" && !reopened().has(file),
  /** Open a viewed file again, or fold it back. */
  toggle: (file: string): void => {
    setReopened((s) => {
      const next = new Set(s);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  },
  /** The mark changed: a file newly marked folds, whatever it was before. */
  marked: (file: string): void => {
    setReopened((s) => {
      if (!s.has(file)) return s;
      const next = new Set(s);
      next.delete(file);
      return next;
    });
  },
};
