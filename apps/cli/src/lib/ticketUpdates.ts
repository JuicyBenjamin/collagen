import { type InvestigationBrief, type OwnedStep, type ReviewContext, type RoomMessage, type StepStatus, type Ticket, deriveThreadId, isJudged, isOwned, isTake, stepThreadId, ticketName } from "@collagen/p2p";
import { actedBy } from "./agents";
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
  /** settled or failed, so somebody's: settling a step nobody had takes it */
  readonly step: OwnedStep;
  readonly from: StepStatus | undefined;
  readonly to: StepStatus;
}

/** Steps that reached settled or failed between two views of the room's tickets. */
export function stepChanges(prev: ReadonlyMap<string, Ticket>, next: ReadonlyMap<string, Ticket>): ReadonlyArray<StepChange> {
  const out: Array<StepChange> = [];
  for (const ticket of next.values()) {
    const before = prev.get(ticket.id);
    for (const step of ticket.steps.filter(isOwned)) {
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
    `${actedBy(review.authorName, review.agent)} ${fresh ? "put the why behind" : "revised the why behind"} the ticket "${ticketName(ticket)}" (${ticket.id})`,
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

/** What the author of an investigation is told when findings come in on it:
 *  whose, on how many goals, and where to read them. */
export const findingsText = (change: StepChange, actorName: string): string => {
  const goals = change.step.answers?.length ?? 0;
  return `${actorName} posted findings${goals > 0 ? ` on ${goals === 1 ? "1 goal" : `${goals} goals`}` : ""} of the investigation "${ticketName(change.ticket)}" (${change.ticket.id}). open-investigation shows them, read at a glance; get-ticket has them as text.`;
};

/** What a participant is told when someone weighs in. */
/** Investigations closed between two snapshots, each with the open tickets
 *  it grew from: their people hear what it found. One already closed when
 *  first seen is history, not news. */
export function answeredInvestigations(prev: ReadonlyMap<string, Ticket>, all: ReadonlyMap<string, Ticket>): ReadonlyArray<{ readonly investigation: Ticket; readonly parents: ReadonlyArray<Ticket> }> {
  const answered: Array<{ investigation: Ticket; parents: ReadonlyArray<Ticket> }> = [];
  for (const ticket of all.values()) {
    const before = prev.get(ticket.id);
    if (ticket.kind !== "investigation" || !ticket.closed || !before || before.closed) continue;
    const parents = (ticket.from ?? []).map((id) => all.get(id)).filter((parent): parent is Ticket => parent !== undefined && parent.id !== ticket.id && !parent.closed);
    if (parents.length > 0) answered.push({ investigation: ticket, parents });
  }
  return answered;
}

/** What an investigation found, told to whoever is on a ticket it grew from. */
export const investigationAnsweredText = (investigation: Ticket, parent: Ticket, brief: InvestigationBrief | undefined, closerName: string): string =>
  [
    `${closerName} closed the investigation "${ticketName(investigation)}" (${investigation.id}), which grew from "${ticketName(parent)}" (${parent.id})${brief?.outcome ? `: ${brief.outcome === "answered" ? "answered" : brief.outcome === "not-answerable" ? "not answerable" : "the wrong question"}` : ""}.`,
    brief?.findings ? `Findings: ${brief.findings}` : investigation.closed?.reason ? `Why it closed: ${investigation.closed.reason}` : "No findings were put on it; review-context on it has whatever was said.",
    brief?.evidence && brief.evidence.length > 0 ? `Evidence: ${brief.evidence.join("; ")}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

export const weighInText = (ticket: Ticket, message: RoomMessage, toName: string): string =>
  `${actedBy(message.fromName, message.agent)} weighed in on the ticket "${ticketName(ticket)}" (${ticket.id}), to ${toName}: ${firstLine(message.findings)}`;
