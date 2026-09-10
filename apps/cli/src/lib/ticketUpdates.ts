import { deriveThreadId, stepThreadId, type ReviewContext, type RoomMessage, type StepStatus, type Ticket, type TicketStep } from "@collagen/p2p";
import { aboutTicket, ticketThreads } from "./ticketSummary";

/** Everyone a ticket concerns: its creator, its step owners, and anyone who
 *  weighed in on it. They all hear about its updates. */
export function isParticipant(ticket: Ticket, messages: ReadonlyArray<RoomMessage>, me: string): boolean {
  if (ticket.createdBy === me || ticket.steps.some((s) => s.owner === me)) return true;
  const threads = ticketThreads(ticket);
  return messages.some((m) => m.from === me && aboutTicket(ticket, threads, m));
}

/** The thread a participant's agent knows this ticket by — the one their own
 *  messages about it went on, else the step they own, else (the creator)
 *  the thread with whoever acted. Updates land there so the adopted session
 *  that already holds the context is the one resumed. */
export function myThreadFor(ticket: Ticket, messages: ReadonlyArray<RoomMessage>, me: string, actor: string): string {
  const threads = ticketThreads(ticket);
  const mine = messages.filter((m) => m.from === me && aboutTicket(ticket, threads, m));
  const latest = mine.at(-1);
  if (latest) return latest.threadId;
  const step = ticket.steps.find((s) => s.owner === me);
  if (step) return stepThreadId(ticket, step);
  const actorsStep = ticket.steps.find((s) => s.owner === actor);
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
      const from = before?.steps.find((s) => s.id === step.id)?.status;
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
  return next.filter((r) => {
    const before = prev.get(r.ticketId);
    return before === undefined || r.ts > before;
  });
}

/** What a participant is told when the why behind a review is revised. */
export const reviewUpdateText = (ticket: Ticket, r: ReviewContext, fresh: boolean): string =>
  [
    `${r.authorName} ${fresh ? "put the why behind" : "revised the why behind"} the ticket "${ticket.goal}" (${ticket.id})`,
    r.branch ? `now ${r.base ? `${r.branch} → ${r.base}` : r.branch}` : "",
    r.link ?? "",
    `${r.decisions.length} decision(s), ${r.forks.length} fork(s)`,
    `${firstLine(r.summary)} — read it with review-context {ticketId} if your person asks what changed; what you read before may be out of date.`,
  ]
    .filter((x) => x.length > 0)
    .join(" · ");

const firstLine = (s: string) => s.split("\n")[0] ?? "";

/** What a participant is told about a step that settled or failed. */
export const stepUpdateText = (c: StepChange, actorName: string): string =>
  `${actorName} ${c.to} step ${c.step.id} (${c.step.intent}) on the ticket "${c.ticket.goal}" (${c.ticket.id}): ${firstLine(c.step.result ?? "")}`;

/** What a participant is told when someone weighs in. */
export const weighInText = (ticket: Ticket, m: RoomMessage, toName: string): string =>
  `${m.fromName} weighed in on the ticket "${ticket.goal}" (${ticket.id}), to ${toName}: ${firstLine(m.findings)}`;
