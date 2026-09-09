import { stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";

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
  const allSettled = ticket.steps.every((s) => s.status === "settled");
  const state: TicketState = waitingOn.includes(me) ? "needs-you" : waitingOn.length > 0 ? "waiting" : failed ? "failed" : allSettled ? "done" : "waiting";

  const threads = ticketThreads(ticket);
  const about = messages.filter((m) => aboutTicket(ticket, threads, m));
  const weighedIn = new Map<string, number>();
  for (const m of about) weighedIn.set(m.from, (weighedIn.get(m.from) ?? 0) + 1);
  const settledBy = new Set(ticket.steps.filter((s) => s.status === "settled" || s.status === "failed").map((s) => s.owner));
  const lastActivity = Math.max(ticket.updatedAt, ...about.map((m) => m.ts));

  return { state, waitingOn, asked: [...new Set(ticket.steps.map((s) => s.owner))], weighedIn, settledBy, lastActivity };
}

/** needs-you first, then waiting, failed, done; newest activity first within. */
export const compareSummaries = (a: TicketSummary, b: TicketSummary): number =>
  ORDER[a.state] - ORDER[b.state] || b.lastActivity - a.lastActivity;

/** `bob✓ you· carol` — asked people first (✓ answered: spoke or settled; · silent), then
 *  those who weighed in unasked. The creator is not "asked" unless they own a step. */
export function peopleLabel(s: TicketSummary, nameFor: (key: string) => string): string {
  const answered = (key: string) => (s.weighedIn.get(key) ?? 0) > 0 || s.settledBy.has(key);
  const asked = s.asked.map((k) => `${nameFor(k)}${answered(k) ? "✓" : "·"}`);
  const others = [...s.weighedIn.keys()].filter((k) => !s.asked.includes(k)).map(nameFor);
  return [...asked, ...others].join(" ");
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
