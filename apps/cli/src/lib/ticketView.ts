import { closedAs, goalsOf, epicBecause, epicOf, epicParts, epicStatus, excludedFromEpic, finished, isClosed, readySteps, visibleTo, type Conversation, type ReviewContext, type Ticket } from "@collagen/p2p";
import { finishLine, reviewHeadline, yourFinish } from "./review";
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
    /** whose move it is: the owners of the steps that are up now — "anyone" for one nobody has taken */
    waitingOn: closed ? "" : [...new Set(readySteps(ticket).map((step) => ownerName(step.owner, nameFor)))].join(", "),
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
  /** which of the author's agents filed it or last revised it — not the person themselves */
  ...(ticket.agent ? { agent: ticket.agent } : {}),
  /** the conversation that agent did it in — yours when it is the one you are in */
  ...(ticket.conversation ? { conversation: conversationLine(ticket.conversation) } : {}),
  /** the tickets this one follows; walk them with review-context when your user asks why */
  ...(ticket.from && ticket.from.length > 0 ? { from: ticket.from.join(" ") } : {}),
  /** questions that grew out of this one: what is still being found out, and what was */
  ...investigationsLine(ticket, all, me),
  /** an investigation: each goal, and what each take found for it */
  ...(ticket.kind === "investigation" ? goalsLines(ticket, review, nameFor) : {}),
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
  /** a review your user finished: their verdict (or how they closed it) and when, as its page shows it — "changed since" when its why was revised after */
  ...yoursLine(ticket, review, me),
  ...(review
    ? { review: `${reviewHeadline(review)} — call review-context {ticketId} when your user asks why something is the way it is` }
    : {}),
  steps: ticket.steps.map((step) => ({
    id: step.id,
    owner: ownerName(step.owner, nameFor),
    intent: step.intent,
    status: step.status,
    needs: step.needs.join("+"),
    description: step.description,
    result: step.result ?? "",
    /** which of the owner's agents wrote its state ("" — the person, or not known) */
    agent: step.agent ?? "",
    /** the conversation that agent wrote it in ("" — not known) */
    conversation: step.conversation ? conversationLine(step.conversation) : "",
  })),
});

/** A conversation as an agent reads it: "codex 019a…", "claude-code 230d…". */
const conversationLine = (conversation: Conversation): string => `${conversation.ai} ${conversation.id}`;

/** Who has a step, by name — or, for one nobody has, that anyone may take it. */
const ownerName = (owner: string | undefined, nameFor: (key: string) => string): string => (owner === undefined ? "anyone (nobody has taken it: take-step)" : nameFor(owner));

/** The investigations grown from a ticket, open first, each with its id and
 *  where it stands — only those `me` may see. */
const investigationsLine = (ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string) => {
  const grown = [...all.values()].filter((other) => other.kind === "investigation" && other.id !== ticket.id && (other.from ?? []).includes(ticket.id) && visibleTo(other, all, me));
  if (grown.length === 0) return {};
  const line = (other: Ticket) => `${other.id} "${other.title ?? other.goal}" (${isClosed(other, all) ? "closed — its findings: review-context on it" : "still open"})`;
  return { investigations: [...grown.filter((other) => !isClosed(other, all)), ...grown.filter((other) => isClosed(other, all))].map(line).join("; ") };
};

/** An investigation's goals as rows: what each asks, its group, and every
 *  take's answer to it — who, how it ended, what they found, what they filed. */
const goalsLines = (ticket: Ticket, review: ReviewContext | undefined, nameFor: (key: string) => string) => {
  const goals = goalsOf(review?.investigation ?? { question: ticket.title ?? ticket.goal });
  const answered = ticket.steps.flatMap((step) => (step.answers ?? []).map((answer) => ({ answer, by: step.owner === undefined ? "someone" : nameFor(step.owner) })));
  return {
    goals: goals.map((goal) => {
      const answers = answered.filter(({ answer }) => answer.goal === goal.id);
      const decided = (questionId: string) => review?.investigation?.decided?.find((had) => had.question === questionId)?.answer;
      const questions = answers.flatMap(({ answer }) =>
        (answer.questions ?? []).map((question) =>
          typeof question === "string" ? question : `${question.id}: ${question.text}${question.then ? ` (yes looks into: ${question.then.title ?? question.then.ask})` : ""}${decided(question.id) ? ` — answered ${decided(question.id)}` : ""}`,
        ),
      );
      return {
        id: goal.id,
        ask: goal.ask,
        group: goal.group ?? "",
        /** what only the author can decide: answer-question {ticketId, questionId, answer} */
        questions: questions.join(" | "),
        answers:
          answers.length === 0
            ? "none yet"
            : answers
                .map(({ answer, by }) =>
                  [`${by}: ${answer.outcome} — ${answer.findings}`, ...(answer.followUps ?? []).map((follow) => (follow.held ? `  since ${follow.if}: ${follow.ask} — ${follow.outcome ?? "answered"}: ${follow.findings ?? ""}` : `  not followed (${follow.if} did not hold): ${follow.ask}`))].join("\n"),
                )
                .join(" | "),
      };
    }),
  };
};

/** Your user's own finish of a review, as a line — from the room: one given only on the host is on the review page. */
function yoursLine(ticket: Ticket, review: ReviewContext | undefined, me: string): { yourUserReviewed?: string } {
  const finish = ticket.kind === "review" && me ? yourFinish(ticket, review, me) : undefined;
  return finish ? { yourUserReviewed: finishLine(finish) } : {};
}
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
