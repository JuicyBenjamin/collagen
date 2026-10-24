import { createSignal } from "solid-js";
import { mergeView, setMerge } from "./api";
import type { MergeFor, MergeView } from "./data";
import { ticketId } from "./ticket";

// Whether collagen merges this review's pull request for its author, as one
// for the page: set ahead in the header, told in Accept. Read once when
// first asked for; a change comes back as collagen now has it.

const [view, setView] = createSignal<MergeView | null>(null);
let asked = false;

export const mergeNow = {
  /** The review's merge setting: its own, its room's, the one in effect —
   *  null until read, or on a review the reader did not file. */
  view(): MergeView | null {
    if (!asked) {
      asked = true;
      void mergeView(ticketId).then(setView, () => setView(null));
    }
    return view();
  },
  /** The review's own level, or null to follow its room's. */
  async set(level: MergeFor | null): Promise<void> {
    const next = await setMerge(ticketId, level).catch(() => null);
    if (next) setView(next);
  },
};
