import { createSignal } from "solid-js";
import type { Assumed, Decision, Fork } from "./data";

// The page's one review, when its why was assumed: whose code it is and what
// was read — set by the page as its data comes in, read wherever a decision
// or a fork is drawn.
const [assumed, setAssumed] = createSignal<Assumed | undefined>(undefined);
const [claimedBy, setClaimedBy] = createSignal<string | undefined>(undefined);

export const assumedNow = {
  /** present when the why on this page is guessed, not told */
  assumed,
  setAssumed,
  /** who took it over — the code's author — once they did */
  claimedBy,
  setClaimedBy,
  /** still a guess: on an assumed review, not answered by the code's author */
  isGuess: (x: Decision | Fork): boolean => assumed() !== undefined && x.verdict === undefined && x.basis !== undefined,
};
