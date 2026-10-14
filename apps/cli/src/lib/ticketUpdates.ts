import { type ReviewContext, type RoomMessage, type StepStatus, type Ticket, type TicketStep, deriveThreadId, isJudged, isTake, stepThreadId, ticketName } from "@collagen/p2p";
import { aboutTicket, ticketThreads } from "./ticketSummary";

/** Everyone a ticket concerns: its creator, its step owners, and anyone who
 *  weighed in on it. They all hear about its updates. */
export function isParticipant(ticket: Ticket, messages: ReadonlyArray<RoomMessage>, me: string): boolean {
  if (ticket.createdBy === me || ticket.steps.some((step) => step.owner === me)) return true;
  const threads = ticketThreads(ticket);
  return messages.some((message) => message.from === me && aboutTicket(ticket, threads, message));
}

/** The thread a participant's agent knows this ticket by — the one their own
 *  messages about it went on, else the step they own, else (the creator)
 *  the thread with whoever acted. Updates land there so the adopted session
 *  that already holds the context is the one resumed. */
export function myThreadFor(ticket: Ticket, messages: ReadonlyArray<RoomMessage>, me: string, actor: string): string {
  const threads = ticketThreads(ticket);
  const mine = messages.filter((message) => message.from === me && aboutTicket(ticket, threads, message));
  const latest = mine.at(-1);
  if (latest) return latest.threadId;
  const step = ticket.steps.find((candidate) => candidate.owner === me);
  if (step) return stepThreadId(ticket, step);
  const actorsStep = ticket.steps.find((candidate) => candidate.owner === actor);
  if (actorsStep && ticket.createdBy === me) return stepThreadId(ticket, actorsStep);
  return deriveThreadId(me, actor, ticket.project);
}

export interface StepChange {
  readonly ticket: Ticket;
  readonly step: TicketStep;
  readonly from: StepStatus | undefined;
  readonly to: StepStatus;
}

/** Steps that reached settled or failed between two views of the room's tickets. */
export function stepChanges(prev: ReadonlyMap<string, Ticket>, next: ReadonlyMap<string, Ticket>): ReadonlyArray<StepChange> {
  const out: Array<StepChange> = [];
  for (const ticket of next.values()) {
    const before = prev.get(ticket.id);
    for (const step of ticket.steps) {
      const from = before?.steps.find((candidate) => candidate.id === step.id)?.status;
      if ((step.status === "settled" || step.status === "failed") && from !== step.status) out.push({ ticket, step, from, to: step.status });
    }
  }
  return out;
}

/** Reviews whose why moved between two views of the room. The lifecycle of a
 *  review does not stop at the first read: the author changes the code, adds
 *  decisions for what changed, points the link at a new branch — and the
 *  people reading it have to hear about it, or the ticket they are reviewing
 *  is not the ticket that exists. */
export function reviewChanges(
  prev: ReadonlyMap<string, number> | null,
  next: ReadonlyArray<ReviewContext>,
): ReadonlyArray<ReviewContext> {
  if (prev === null) return []; // what the log already held is history, not news
  return next.filter((review) => {
    const before = prev.get(review.ticketId);
    return before === undefined || review.ts > before;
  });
}

/** What a participant is told when the why behind a review is revised. */
export const reviewUpdateText = (ticket: Ticket, review: ReviewContext, fresh: boolean): string =>
  [
    `${review.authorName} ${fresh ? "put the why behind" : "revised the why behind"} the ticket "${ticketName(ticket)}" (${ticket.id})`,
    review.branch ? `now ${review.base ? `${review.branch} → ${review.base}` : review.branch}` : "",
    review.link ?? "",
    `${review.decisions.length} decision(s), ${review.forks.length} fork(s)`,
    `${firstLine(review.summary)} — read it with review-context {ticketId} if your person asks what changed; what you read before may be out of date.`,
  ]
    .filter((line) => line.length > 0)
    .join(" · ");

const firstLine = (text: string) => text.split("\n")[0] ?? "";

/** What happened, in the words that state actually has. On a review ticket
 *  "failed" is how a reader says they want changes, so calling it a failure —
 *  in the message, its intent, or the activity line — describes the most
 *  complete kind of review there is as a breakdown. */
export const stepUpdateWhat = (change: StepChange): string =>
  isJudged(change.ticket.kind) && isTake(change.step) && change.to === "failed" ? "asked for changes" : change.to;

/** What a participant is told about a step that settled or failed. */
export const stepUpdateText = (change: StepChange, actorName: string): string => {
  const what = stepUpdateWhat(change);
  const did = what === change.to ? `${what} step` : `${what} on`;
  return `${actorName} ${did} ${change.step.id} (${change.step.intent}) on the ticket "${ticketName(change.ticket)}" (${change.ticket.id}): ${firstLine(change.step.result ?? "")}`;
};

/** What a participant is told when someone weighs in. */
export const weighInText = (ticket: Ticket, message: RoomMessage, toName: string): string =>
  `${message.fromName} weighed in on the ticket "${ticketName(ticket)}" (${ticket.id}), to ${toName}: ${firstLine(message.findings)}`;
