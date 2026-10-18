import { closedAs, epicBecause, epicOf, epicParts, epicStatus, excludedFromEpic, finished, isClosed, readySteps, visibleTo, type ReviewContext, type Ticket } from "@collagen/p2p";
import { reviewHeadline } from "./review";
import { rowTitle } from "./ticketSummary";

/** A ticket as a list row: what it is, the line beneath its title, where it
 *  stands and whose move it is — enough to pick one; its steps, results and
 *  why are a get-ticket away. An epic's status says how far along it is. */
export const ticketRow = (ticket: Ticket, nameFor: (key: string) => string, heldBy: ReadonlyArray<string>, all: ReadonlyMap<string, Ticket>, review?: ReviewContext) => {
  const closed = isClosed(ticket, all);
  const progress = () => {
    const { counted, done } = epicParts(ticket, all);
    return `${done} of ${counted} done`;
  };
  const status = closed ? "closed" : heldBy.length > 0 ? "held" : ticket.kind !== "epic" && finished(ticket) ? "answered" : "open";
  return {
    id: ticket.id,
    kind: ticket.kind,
    title: rowTitle(ticket),
    /** a review's summary is the line beneath its title (its goal is most often just its branch) */
    subtitle: ticket.kind === "review" && review?.summary.trim() ? review.summary.trim() : ticket.goal,
    status: ticket.kind === "epic" ? `${status} · ${progress()}` : status,
    /** whose move it is: the owners of the steps that are up now */
    waitingOn: closed ? "" : [...new Set(readySteps(ticket).map((step) => nameFor(step.owner)))].join(", "),
    epic: epicOf(ticket) ?? "",
  };
};

/** A ticket as the agent reads it: keys resolved to names, needs joined. A
 *  review ticket also says where the code is and how much why came with it —
 *  the why itself is not here on purpose: it is read on demand, when the
 *  person asks (review-context), not poured into every listing. */
export const ticketView = (ticket: Ticket, nameFor: (key: string) => string, review?: ReviewContext, heldBy: ReadonlyArray<string> = [], all: ReadonlyMap<string, Ticket> = new Map(), me = "") => ({
  id: ticket.id,
  project: ticket.project,
  kind: ticket.kind,
  /** its headline in every list; the goal is the line beneath it */
  title: rowTitle(ticket),
  goal: ticket.goal,
  createdBy: nameFor(ticket.createdBy),
  /** the tickets this one follows; walk them with review-context when your user asks why */
  ...(ticket.from && ticket.from.length > 0 ? { from: ticket.from.join(" ") } : {}),
  /** the tickets this one waits on (read after them) */
  ...(ticket.after && ticket.after.length > 0 ? { after: ticket.after.join(" ") } : {}),
  /** still waiting: only its author is shown it, nobody is nudged, until these are answered */
  ...(heldBy.length > 0 ? { waitingOn: `${heldBy.join(" ")} — hidden from everyone but its author until answered` } : {}),
  ...(ticket.whenClosed ? { whenClosed: ticket.whenClosed } : {}),
  /** the epic it was put in, if any */
  ...epicLine(ticket, all),
  /** an epic: what is in it, and how far along */
  ...(ticket.kind === "epic" ? partsLine(ticket, all, me) : {}),
  /** every step answered — ready for its author to close, if they say so */
  answered: ticket.kind === "epic" ? false : finished(ticket),
  /** recorded: off the lists, still here to refer back to (an epic can be reopened) */
  closed: isClosed(ticket, all),
  /** how its author closed it: done, or dropped (one closed before this was asked reads as done) */
  ...(ticket.kind !== "epic" && closedAs(ticket) ? { closedAs: closedAs(ticket)! } : {}),
  ...(ticket.kind === "epic" ? becauseLine(ticket, all, me) : ticket.closed?.reason ? { closedBecause: ticket.closed.reason } : {}),
  ...(review
    ? { review: `${reviewHeadline(review)} — call review-context {ticketId} when your user asks why something is the way it is` }
    : {}),
  steps: ticket.steps.map((step) => ({
    id: step.id,
    owner: nameFor(step.owner),
    intent: step.intent,
    status: step.status,
    needs: step.needs.join("+"),
    description: step.description,
    result: step.result ?? "",
  })),
});

/** "epic: <id> "<goal>"" for a ticket put in one — and when it is kept out
 *  of the epic's progress. */
function epicLine(ticket: Ticket, all: ReadonlyMap<string, Ticket>): { epic?: string } {
  const home = epicOf(ticket);
  if (!home) return {};
  const goal = all.get(home)?.goal;
  return { epic: `${home}${goal ? ` "${goal}"` : ""}${excludedFromEpic(ticket) ? " (excluded from its progress)" : ""}` };
}

/** An epic's tickets by id in reading order, how many are done of those
 *  counted, and what still keeps it from closing. The count is the room's;
 *  the ids are only those this reader may be shown (a ticket waiting on
 *  another is its author's alone). */
function partsLine(epic: Ticket, all: ReadonlyMap<string, Ticket>, me: string): { parts: string; unresolved?: string } {
  const { parts, counted, done, unresolved } = epicParts(epic, all);
  const shown = (ticket: Ticket) => visibleTo(ticket, all, me);
  return {
    parts: parts.length === 0 ? "none yet" : `${done} of ${counted} pieces of work done: ${parts.filter(shown).map((part) => part.id).join(" ")}`,
    ...(unresolved.length > 0 ? { unresolved: unresolved.filter(shown).map((ticket) => ticket.id).join(" ") || `${unresolved.length} not shown to you yet` } : {}),
  };
}

/** Why an epic is as it is — the cause behind its state, as epicStatus
 *  decides it, said for this reader (a ticket they may not see is unnamed). */
function becauseLine(epic: Ticket, all: ReadonlyMap<string, Ticket>, me: string): { closedBecause?: string; openBecause?: string } {
  const status = epicStatus(epic, all);
  const why = epicBecause(status, all, me);
  return why ? (status.closed ? { closedBecause: why } : { openBecause: why }) : {};
}
