import { epicHome, epicOf, epicParts, epicTurn, finished, isClosed, type ReviewContext, type Ticket } from "@collagen/p2p";
import { reviewHeadline } from "./review";

/** A ticket as the agent reads it: keys resolved to names, needs joined. A
 *  review ticket also says where the code is and how much why came with it —
 *  the why itself is not here on purpose: it is read on demand, when the
 *  person asks (review-context), not poured into every listing. */
export const ticketView = (ticket: Ticket, nameFor: (key: string) => string, review?: ReviewContext, heldBy: ReadonlyArray<string> = [], all: ReadonlyMap<string, Ticket> = new Map()) => ({
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
  /** the epic it lives in — put there, or grown out of a ticket that is */
  ...epicLine(ticket, all),
  /** an epic: what is in it, and how far along */
  ...(ticket.kind === "epic" ? partsLine(ticket, all) : {}),
  /** every step answered — ready for its author to close, if they say so */
  answered: ticket.kind === "epic" ? false : finished(ticket),
  /** recorded: off the lists, still here to refer back to (an epic can be reopened) */
  closed: isClosed(ticket),
  ...(ticket.kind === "epic" ? (epicTurn(ticket) ? { [isClosed(ticket) ? "closedBecause" : "reopenedBecause"]: epicTurn(ticket)!.reason } : {}) : ticket.closed?.reason ? { closedBecause: ticket.closed.reason } : {}),
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

/** "epic: <id> "<goal>"" for a ticket that lives in one, saying when it is
 *  there only through what it grew out of. */
function epicLine(ticket: Ticket, all: ReadonlyMap<string, Ticket>): { epic?: string } {
  const home = epicHome(ticket, all);
  if (!home) return {};
  const goal = all.get(home)?.goal;
  return { epic: `${home}${goal ? ` "${goal}"` : ""}${epicOf(ticket) === home ? "" : " (through the ticket it grew out of)"}` };
}

/** An epic's parts by id, and how many are done. */
function partsLine(epic: Ticket, all: ReadonlyMap<string, Ticket>): { parts: string } {
  const { parts, done } = epicParts(epic, all);
  return { parts: parts.length === 0 ? "none yet" : `${done} of ${parts.length} done: ${parts.map((p) => p.id).join(" ")}` };
}
