import { finished, type ReviewContext, type Ticket } from "@collagen/p2p";
import { reviewHeadline } from "./review";

/** A ticket as the agent reads it: keys resolved to names, needs joined. A
 *  review ticket also says where the code is and how much why came with it —
 *  the why itself is not here on purpose: it is read on demand, when the
 *  person asks (review-context), not poured into every listing. */
export const ticketView = (ticket: Ticket, nameFor: (key: string) => string, review?: ReviewContext, heldBy: ReadonlyArray<string> = []) => ({
  id: ticket.id,
  project: ticket.project,
  kind: ticket.kind,
  goal: ticket.goal,
  createdBy: nameFor(ticket.createdBy),
  /** the tickets this one follows; walk them with review-context when your user asks why */
  ...(ticket.from && ticket.from.length > 0 ? { from: ticket.from.join(" ") } : {}),
  /** the tickets this one waits on (read after them) */
  ...(ticket.after && ticket.after.length > 0 ? { after: ticket.after.join(" ") } : {}),
  /** still waiting: only its author is shown it, nobody is nudged, until these are answered */
  ...(heldBy.length > 0 ? { waitingOn: `${heldBy.join(" ")} — hidden from everyone but its author until answered` } : {}),
  ...(ticket.whenClosed ? { whenClosed: ticket.whenClosed } : {}),
  /** every step answered — ready for its author to close, if they say so */
  answered: finished(ticket),
  /** the author's decision, recorded: off the lists, still here to refer back to */
  closed: ticket.closed !== undefined,
  ...(ticket.closed?.reason ? { closedBecause: ticket.closed.reason } : {}),
  ...(review
    ? { review: `${reviewHeadline(review)} — call review-context {ticketId} when your user asks why something is the way it is` }
    : {}),
  steps: ticket.steps.map((s) => ({
    id: s.id,
    owner: nameFor(s.owner),
    intent: s.intent,
    status: s.status,
    needs: s.needs.join("+"),
    description: s.description,
    result: s.result ?? "",
  })),
});
