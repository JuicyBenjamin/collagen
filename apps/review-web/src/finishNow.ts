import { createSignal } from "solid-js";
import type { ReviewedAs, YourReview } from "./data";

// A finish the reader just gave on this page. The room's record of it comes
// back with the review's next read, a moment later; until it does, the page
// shows the finish from here, so the bar turns the moment the submit is
// through and never looks as if nothing happened.

const [given, setGiven] = createSignal<YourReview | null>(null);

/** The reader finished the review here, as `as`. */
export const gave = (as: ReviewedAs): void => void setGiven({ as, at: Date.now(), since: false });

/** The reader's finish: what the room and the host know, or the one just
 *  given here while their word on it is still on its way. */
export const withGiven = (known: YourReview | null): YourReview | null => {
  const just = given();
  if (!just) return known;
  // the room's word on the same finish: a few seconds either side of ours
  const caughtUp = known !== null && known.as === just.as && known.at >= just.at - 60_000;
  return caughtUp || (known !== null && known.at > just.at) ? known : just;
};
