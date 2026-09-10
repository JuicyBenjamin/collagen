import { stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
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
  /** What each person did, as a mark: see lib/glyphs. */
  readonly marks: ReadonlyMap<string, Mark>;
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
  const settled = new Set(ticket.steps.filter((s) => s.status === "settled").map((s) => s.id));
  const up = ticket.steps.filter((s) => (s.status === "pending" || s.status === "suspended") && s.needs.every((n) => settled.has(n)));
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
  const marks = new Map<string, Mark>();
  const rank: Record<Mark, number> = { changes: 5, failed: 5, approved: 4, spoke: 3, up: 2, quiet: 1 };
  const put = (key: string, mark: Mark) => {
    const had = marks.get(key);
    if (had === undefined || rank[mark] > rank[had]) marks.set(key, mark);
  };
  for (const key of new Set(ticket.steps.map((s) => s.owner))) put(key, "quiet");
  for (const key of waitingOn) put(key, "up");
  for (const key of weighedIn.keys()) put(key, "spoke");
  for (const step of ticket.steps) {
    if (step.status === "settled") put(step.owner, "approved");
    if (step.status === "failed") put(step.owner, ticket.kind === "review" && step.intent === "review" ? "changes" : "failed");
  }

  return { state, waitingOn, asked: [...new Set(ticket.steps.map((s) => s.owner))], weighedIn, settledBy, marks, lastActivity };
}

/** needs-you first, then waiting, failed, done; newest activity first within. */
export const compareSummaries = (a: TicketSummary, b: TicketSummary): number =>
  ORDER[a.state] - ORDER[b.state] || b.lastActivity - a.lastActivity;

/** `bob ✓  you ↻  carol ·` — who is on the ticket and what they did (see
 *  lib/glyphs for the marks). Asked people first, then anyone who weighed in
 *  unasked; the creator is not "asked" unless they own a step. The glyph is
 *  its own word, a space off the name: `you✓` reads as one token, and on a
 *  review it read as if the person had approved their own change. */
export function peopleLabel(s: TicketSummary, nameFor: (key: string) => string): string {
  const one = (key: string) => {
    const mark = s.marks.get(key);
    return mark === undefined ? nameFor(key) : `${nameFor(key)} ${GLYPH[mark]}`;
  };
  const asked = s.asked.map(one);
  const others = [...s.weighedIn.keys()].filter((k) => !s.asked.includes(k)).map(one);
  return [...asked, ...others].join("  ");
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
