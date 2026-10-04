import { createSignal } from "solid-js";
import { assumedStore } from "./assumed";
import type { Assumed } from "./data";
import { ticketId } from "./ticket";

// The page's one review, when its why was assumed: whose code it is and what
// was read — set by the page as its data comes in, read wherever a decision
// or a fork is drawn — and the reader's checks on each guess.
const [assumed, setAssumed] = createSignal<Assumed | undefined>(undefined);

export const assumedNow = {
  /** present when the why on this page is guessed, not told */
  assumed,
  setAssumed,
  checks: assumedStore(ticketId),
};
