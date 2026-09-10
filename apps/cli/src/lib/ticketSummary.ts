import { readySteps, stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
import { GLYPH, type Mark } from "./glyphs";

/** What a ticket wants from the person, now. */
export type TicketState = "needs-you" | "waiting" | "failed" | "done";

export interface TicketSummary {
  readonly state: TicketState;
  /** Owners (keys) of the steps that are up right now. */
  readonly waitingOn: ReadonlyArray<string>;
  /** Everyone asked to own a step, in step order, distinct. */
  readonly asked: ReadonlyArray<string>;
  /** Who spoke about it (messages about the ticket, or on its threads), how often. */
  readonly weighedIn: ReadonlyMap<string, number>;
  /** Owners who settled or failed a step of theirs. */
  readonly settledBy: ReadonlySet<string>;
  /** What each person did, as a mark: see lib/glyphs. Nobody appears here
   *  who has done nothing — a bare name says that. */
  readonly marks: ReadonlyMap<string, Mark>;
  /** Did this person start it? The lists colour their own tickets. */
  readonly mine: boolean;
  /** Whose view this is — so a row can leave them out of its own people. */
  readonly me: string;
  /** Newest of the ticket's own update and its last message. */
  readonly lastActivity: number;
}

const ORDER: Record<TicketState, number> = { "needs-you": 0, waiting: 1, failed: 2, done: 3 };

/** Is this message part of the ticket's conversation? Tagged with it, or on
 *  one of the threads its steps travel on. */
export const aboutTicket = (ticket: Ticket, threads: ReadonlySet<string>, m: RoomMessage): boolean =>
  m.ticketId === ticket.id || (m.ticketId === undefined && threads.has(m.threadId));

export const ticketThreads = (ticket: Ticket): ReadonlySet<string> => new Set(ticket.steps.map((s) => stepThreadId(ticket, s)));

export function summarize(ticket: Ticket, messages: ReadonlyArray<RoomMessage>, me: string): TicketSummary {
  // one readiness rule, in p2p, shared with the agent nudges: this used to
  // be a second copy of it here, and the copy was already wrong (it did not
  // know that an open review waits for a reader, so the overview said
  // needs-you about a ticket nobody had reviewed)
  const up = readySteps(ticket);
  const waitingOn = [...new Set(up.map((s) => s.owner))];
  const failed = ticket.steps.some((s) => s.status === "failed");
  // a ticket with no steps at all is not "done" — nobody has done anything
  const allSettled = ticket.steps.length > 0 && ticket.steps.every((s) => s.status === "settled");
  const state: TicketState = waitingOn.includes(me) ? "needs-you" : waitingOn.length > 0 ? "waiting" : failed ? "failed" : allSettled ? "done" : "waiting";

  const threads = ticketThreads(ticket);
  const about = messages.filter((m) => aboutTicket(ticket, threads, m));
  const weighedIn = new Map<string, number>();
  for (const m of about) weighedIn.set(m.from, (weighedIn.get(m.from) ?? 0) + 1);
  const settledBy = new Set(ticket.steps.filter((s) => s.status === "settled" || s.status === "failed").map((s) => s.owner));
  const lastActivity = Math.max(ticket.updatedAt, ...about.map((m) => m.ts));

  // what each person did, strongest thing first: a failed step outranks a
  // settled one (they asked for something), and both outrank talking. On a
  // review ticket a failed step is not a failure, it is changes asked for.
  // Someone who has done nothing gets no entry: their name stands alone.
  const marks = new Map<string, Mark>();
  const rank: Record<Mark, number> = { changes: 3, failed: 3, approved: 2, spoke: 1 };
  const put = (key: string, mark: Mark) => {
    const had = marks.get(key);
    if (had === undefined || rank[mark] > rank[had]) marks.set(key, mark);
  };
  for (const key of weighedIn.keys()) put(key, "spoke");
  for (const step of ticket.steps) {
    if (step.status === "settled") put(step.owner, "approved");
    if (step.status === "failed") put(step.owner, ticket.kind === "review" && step.intent === "review" ? "changes" : "failed");
  }

  return {
    state,
    waitingOn,
    asked: [...new Set(ticket.steps.map((s) => s.owner))],
    weighedIn,
    settledBy,
    marks,
    mine: ticket.createdBy === me,
    me,
    lastActivity,
  };
}

/** needs-you first, then waiting, failed, done; newest activity first within. */
export const compareSummaries = (a: TicketSummary, b: TicketSummary): number =>
  ORDER[a.state] - ORDER[b.state] || b.lastActivity - a.lastActivity;

/** `bob ✓  carol ✓  dave ↻` — the OTHER people on the ticket and what each of
 *  them did (see lib/glyphs), so two approvals and one asking for changes can
 *  be counted at a glance. Asked people first, then anyone who weighed in
 *  unasked.
 *
 *  The reader is not in their own list. "you" said only that they own a step
 *  here, which on a review they always do — it was true of every row and so
 *  told nobody anything; whether a row wants them is said by its place in the
 *  list and its colour. Whose ticket it is, is said by the colour of the kind.
 *
 *  A mark is its own word, a space off the name: `bob✓` reads as one token,
 *  and on a review it read as if bob had approved his own change. */
export function peopleLabel(s: TicketSummary, nameFor: (key: string) => string): string {
  const one = (key: string) => {
    const mark = s.marks.get(key);
    return mark === undefined ? nameFor(key) : `${nameFor(key)} ${GLYPH[mark]}`;
  };
  const others = s.asked.filter((k) => k !== s.me);
  const unasked = [...s.weighedIn.keys()].filter((k) => k !== s.me && !s.asked.includes(k));
  return [...others, ...unasked].map(one).join("  ");
}

/** "2m" · "3h" · "5d" — compact, for a list column. */
export function age(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const STATE_LABEL: Record<TicketState, string> = { "needs-you": "needs you", waiting: "waiting", failed: "failed", done: "done" };
