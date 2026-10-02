import { epicParts, finished, isClosed, isJudged, isTake, readySteps, stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
import { NO_TITLE } from "./review";

/** A ticket's line in the TUI: its title. An old ticket filed before titles
 *  says so rather than passing its goal off as one — except an epic, whose
 *  goal was always a name. */
export const rowTitle = (t: Pick<Ticket, "title" | "goal" | "kind">): string => t.title ?? (t.kind === "epic" ? t.goal : `(${NO_TITLE})`);
import { GLYPH, type Mark } from "./glyphs";

/** What a ticket wants from the person, now. "done": every step answered
 *  and the author has not closed it yet — theirs to close, so on their own
 *  ticket it is needs-you. "closed": the author's decision, recorded; off the
 *  lists, on the log. */
export type TicketState = "needs-you" | "waiting" | "failed" | "done" | "closed";

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
  /** The author's own take on their own ticket, when they gave one — a
   *  self-approval is allowed, and shown as the author's so nobody reads it
   *  as a colleague's. */
  readonly authorMark: Mark | null;
  readonly author: string;
  /** Did this person start it? The lists colour their own tickets. */
  readonly mine: boolean;
  /** Newest of the ticket's own update and its last message. */
  readonly lastActivity: number;
  /** The tickets in its `after` still unanswered — while there are any, it
   *  waits on them and on nobody else (p2p heldBy). */
  readonly held: ReadonlyArray<string>;
}

const ORDER: Record<TicketState, number> = { "needs-you": 0, waiting: 1, failed: 2, done: 3, closed: 4 };

/** Is this message part of the ticket's conversation? Tagged with it, or on
 *  one of the threads its steps travel on. */
export const aboutTicket = (ticket: Ticket, threads: ReadonlySet<string>, m: RoomMessage): boolean =>
  m.ticketId === ticket.id || (m.ticketId === undefined && threads.has(m.threadId));

export const ticketThreads = (ticket: Ticket): ReadonlySet<string> => new Set(ticket.steps.map((s) => stepThreadId(ticket, s)));

/** How far along an epic is: its parts, and how many are done. */
export interface EpicProgress {
  readonly parts: number;
  readonly done: number;
}

export const epicProgress = (epic: Ticket, all: ReadonlyMap<string, Ticket>): EpicProgress => {
  const { counted, done } = epicParts(epic, all);
  return { parts: counted, done };
};

/** "2 of 3 done" — an epic's row and page. */
export const progressLabel = (p: EpicProgress): string => (p.parts === 0 ? "no parts yet" : p.done === p.parts ? `all ${p.parts} done` : `${p.done} of ${p.parts} done`);

export function summarize(ticket: Ticket, messages: ReadonlyArray<RoomMessage>, me: string, held: ReadonlyArray<string> = [], all?: ReadonlyMap<string, Ticket>): TicketSummary {
  // one readiness rule, in p2p, shared with the agent nudges: this used to
  // be a second copy of it here, and the copy was already wrong (it did not
  // know that an open review waits for a reader, so the overview said
  // needs-you about a ticket nobody had reviewed)
  // a ticket waiting on another has nothing up for anyone: nobody is
  // delivered a step of it until the one it waits on is answered
  const up = held.length > 0 && !isClosed(ticket, all) ? [] : readySteps(ticket);
  const waitingOn = [...new Set(up.map((s) => s.owner))];
  // completion is p2p's `finished`: every step answered, where on a review a
  // reader's ↻ is an answer. Closure is the author's recorded decision. A
  // finished ticket the author has not closed is theirs to close — needs-you
  // on their own row, "done" on everyone else's.
  const mine = ticket.createdBy === me;
  const done = finished(ticket);
  const failed = !done && ticket.steps.some((s) => s.status === "failed");
  const state: TicketState = isClosed(ticket, all)
    ? "closed"
    : held.length > 0
      ? "waiting"
      : waitingOn.includes(me) || (done && mine)
        ? "needs-you"
        : waitingOn.length > 0
          ? "waiting"
          : failed
            ? "failed"
            : done
              ? "done"
              : "waiting";

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
  const rank: Record<Mark, number> = { changes: 3, failed: 3, approved: 2, spoke: 1, yours: 0 }; // `yours` is a row mark, never a person's
  const put = (key: string, mark: Mark) => {
    const had = marks.get(key);
    if (had === undefined || rank[mark] > rank[had]) marks.set(key, mark);
  };
  for (const key of weighedIn.keys()) put(key, "spoke");
  for (const step of ticket.steps) {
    // on a judged ticket, only a TAKE is a mark: the author's own address step
    // settling is them acting, not them approving their own change
    if (isJudged(ticket.kind) && !isTake(step)) continue;
    if (step.status === "settled") put(step.owner, "approved");
    if (step.status === "failed") put(step.owner, isJudged(ticket.kind) && isTake(step) ? "changes" : "failed");
  }

  return {
    state,
    waitingOn,
    asked: [...new Set(ticket.steps.map((s) => s.owner))],
    weighedIn,
    settledBy,
    marks,
    authorMark: marks.get(ticket.createdBy) ?? null,
    author: ticket.createdBy,
    mine,
    lastActivity,
    held,
  };
}

/** needs-you first, then waiting, failed, done; newest activity first within. */
export const compareSummaries = (a: TicketSummary, b: TicketSummary): number =>
  ORDER[a.state] - ORDER[b.state] || b.lastActivity - a.lastActivity;

/** `↻ ✓` — what has been said on the ticket, not by whom: changes were
 *  asked for, someone approved, a step failed, someone spoke. One glyph per
 *  kind of answer however many gave it, in the order that demands attention.
 *  Names were here and came out: at a glance it is what was said that
 *  matters, and "you ↻" read as the reader having asked themselves for
 *  changes. Who said what is on the ticket's page, step by step. */
export function marksLabel(s: TicketSummary): string {
  const others = new Set<Mark>();
  for (const [who, m] of s.marks) if (who !== s.author) others.add(m);
  const said = (["changes", "failed", "approved", "spoke"] as const).filter((m) => others.has(m)).map((m) => GLYPH[m]);
  // the author's own take is attributed — "self ✓" — the one place a word
  // stays beside a glyph: a colleague's ✓ and a self-approval must not read alike
  return [...said, ...(s.authorMark !== null ? [`self ${GLYPH[s.authorMark]}`] : [])].join(" ");
}

/** "2m" · "3h" · "5d" — compact, for a list column. */
export function age(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const STATE_LABEL: Record<TicketState, string> = { "needs-you": "needs you", waiting: "waiting", failed: "failed", done: "done", closed: "closed" };

/** What each state means, spelled out — for the ? panel. */
export const STATE_WORDS: Record<TicketState, string> = {
  "needs-you": "a step of yours is up — or every step of your own ticket is answered and it is yours to close",
  waiting: "a step is up for somebody else",
  failed: "a step failed, and nothing is up",
  done: "every step answered; its author has not closed it yet",
  closed: "its author closed it: off the lists, kept on the log",
};

/** The states in the order the list sorts them. */
export const STATE_ORDER: ReadonlyArray<TicketState> = (Object.keys(ORDER) as Array<TicketState>).sort((a, b) => ORDER[a] - ORDER[b]);
