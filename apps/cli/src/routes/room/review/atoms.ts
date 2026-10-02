import { Effect } from "effect";
import { ReviewPages } from "../../../services/ReviewLive";
import { runtimeAtom } from "../../../app/runtime";

/** o on a review: open its page in the person's browser, or bring an open
 *  one forward (ReviewPages.show). What happened goes to the activity log,
 *  url included, for a machine with no browser to open. */
export const openReviewPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ ticketId }: { ticketId: string }) {
    yield* Effect.log(yield* (yield* ReviewPages).show(ticketId));
  }),
);
