import { deriveThreadId, stepThreadId, type RoomMessage, type StepStatus, type Ticket, type TicketStep } from "@collagen/p2p";
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

const firstLine = (s: string) => s.split("\n")[0] ?? "";

/** What a participant is told about a step that settled or failed. */
export const stepUpdateText = (c: StepChange, actorName: string): string =>
  `${actorName} ${c.to} step ${c.step.id} (${c.step.intent}) on the ticket "${c.ticket.goal}" (${c.ticket.id}): ${firstLine(c.step.result ?? "")}`;

/** What a participant is told when someone weighs in. */
export const weighInText = (ticket: Ticket, m: RoomMessage, toName: string): string =>
  `${m.fromName} weighed in on the ticket "${ticket.goal}" (${ticket.id}), to ${toName}: ${firstLine(m.findings)}`;
