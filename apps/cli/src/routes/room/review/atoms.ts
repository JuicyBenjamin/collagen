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

/** A in a room: open its audit page in the person's browser
 *  (ReviewPages.showAudit). What happened goes to the activity log. */
export const openAuditPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ roomId }: { roomId: string }) {
    yield* Effect.log(yield* (yield* ReviewPages).showAudit(roomId));
  }),
);

/** o on an investigation: open its page in the person's browser
 *  (ReviewPages.showInvestigation). What happened goes to the activity log. */
export const openInvestigationPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ ticketId }: { ticketId: string }) {
    yield* Effect.log(yield* (yield* ReviewPages).showInvestigation(ticketId));
  }),
);
