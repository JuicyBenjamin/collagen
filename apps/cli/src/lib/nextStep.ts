import { finished, isClosed, isJudged, isOwned, isTake, readySteps, takeIntent, type Ticket } from "@collagen/p2p";

// What a ticket waits on next, said one way wherever it is shown — the
// review page, the TUI, the agent's get-ticket: an ask that waits on
// someone's hands (their steering left it to them), else the steps up now
// and whose they are, else its author closing it. A job running on it is
// said apart (lib/running), with how far it is. Pure.

/** Who the ticket waits on, and for what; manual when it waits on a person's hands rather than a step. */
export interface NextStep {
  readonly who: string;
  readonly what: string;
  readonly manual: boolean;
}

/** A step's intent as what it waits for. */
const STEP_WORDS: Readonly<Record<string, string>> = {
  review: "a review",
  address: "acting on the review",
  take: "a take",
  investigate: "investigating it",
  implement: "building it",
  do: "doing it",
};

const wordsOf = (intent: string): string => STEP_WORDS[intent] ?? intent;

/** The next step on `ticket`. `awaiting`: asks on it that wait on someone's
 *  hands, as peers share them; `held`: the tickets it waits on, if any;
 *  `nameOf`: a key as the reader says it ("you" for themselves). Null when
 *  nothing is next: closed, or waiting on another ticket. */
export const nextStepOf = (
  ticket: Ticket,
  all: ReadonlyMap<string, Ticket>,
  held: ReadonlyArray<string>,
  awaiting: ReadonlyArray<{ readonly who: string; readonly what: string }>,
  nameOf: (key: string) => string,
): NextStep | null => {
  if (isClosed(ticket, all)) return null;
  const hands = awaiting[0];
  if (hands) return { who: hands.who, what: `manual action — ${hands.what}`, manual: true };
  if (held.length > 0) return null;
  const up = readySteps(ticket);
  const owners = [...new Set(up.filter(isOwned).map((step) => step.owner))];
  if (owners.length > 0) return { who: owners.map(nameOf).join(", "), what: wordsOf(up.find(isOwned)!.intent), manual: false };
  if (up.length > 0) return { who: "anyone", what: `${wordsOf(up[0]!.intent)} — nobody has taken it yet`, manual: false };
  if (finished(ticket)) return { who: nameOf(ticket.createdBy), what: "closing it", manual: false };
  // open to the room and nobody asked: it waits on a reader before its author's step is up
  if (isJudged(ticket.kind) && !ticket.steps.some((step) => isTake(step) && (step.status === "settled" || step.status === "failed")))
    return { who: "anyone in the room", what: wordsOf(takeIntent(ticket.kind)), manual: false };
  return null;
};

/** The next step as one line a person reads. */
export const nextLine = (next: NextStep): string => `Awaiting ${next.who}: ${next.what}`;
