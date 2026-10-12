import { epicParts, finished, isClosed, isJudged, isTake, readySteps, stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
import { NO_TITLE } from "./review";

/** A ticket's line in the TUI: its title. An old ticket filed before titles
 *  says so rather than passing its goal off as one — except an epic, whose
 *  goal was always a name. */
export const rowTitle = (ticket: Pick<Ticket, "title" | "goal" | "kind">): string => ticket.title ?? (ticket.kind === "epic" ? ticket.goal : `(${NO_TITLE})`);
import { GLYPH, type Mark } from "./glyphs";
import { via } from "./agents";

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
  /** Which of the author's agents gave their own take, when one did. */
  readonly authorAgent?: string;
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
export const aboutTicket = (ticket: Ticket, threads: ReadonlySet<string>, message: RoomMessage): boolean =>
  message.ticketId === ticket.id || (message.ticketId === undefined && threads.has(message.threadId));

export const ticketThreads = (ticket: Ticket): ReadonlySet<string> => new Set(ticket.steps.map((step) => stepThreadId(ticket, step)));

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
/** The same, for a row with no room to spare: "2/3". */
export const progressShort = (progress: EpicProgress): string => (progress.parts === 0 ? "empty" : `${progress.done}/${progress.parts}`);

export const progressLabel = (progress: EpicProgress): string => (progress.parts === 0 ? "no parts yet" : progress.done === progress.parts ? `all ${progress.parts} done` : `${progress.done} of ${progress.parts} done`);

export function summarize(ticket: Ticket, messages: ReadonlyArray<RoomMessage>, me: string, held: ReadonlyArray<string> = [], all?: ReadonlyMap<string, Ticket>): TicketSummary {
  // one readiness rule, in p2p, shared with the agent nudges: this used to
  // be a second copy of it here, and the copy was already wrong (it did not
  // know that an open review waits for a reader, so the overview said
  // needs-you about a ticket nobody had reviewed)
  // a ticket waiting on another has nothing up for anyone: nobody is
  // delivered a step of it until the one it waits on is answered
  const up = held.length > 0 && !isClosed(ticket, all) ? [] : readySteps(ticket);
  const waitingOn = [...new Set(up.map((step) => step.owner))];
  // completion is p2p's `finished`: every step answered, where on a review a
  // reader's ↻ is an answer. Closure is the author's recorded decision. A
  // finished ticket the author has not closed is theirs to close — needs-you
  // on their own row, "done" on everyone else's.
  const mine = ticket.createdBy === me;
  const done = finished(ticket);
  const failed = !done && ticket.steps.some((step) => step.status === "failed");
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
  const about = messages.filter((message) => aboutTicket(ticket, threads, message));
  const weighedIn = new Map<string, number>();
  for (const message of about) weighedIn.set(message.from, (weighedIn.get(message.from) ?? 0) + 1);
  const settledBy = new Set(ticket.steps.filter((step) => step.status === "settled" || step.status === "failed").map((step) => step.owner));
  const lastActivity = Math.max(ticket.updatedAt, ...about.map((message) => message.ts));

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
    asked: [...new Set(ticket.steps.map((step) => step.owner))],
    weighedIn,
    settledBy,
    marks,
    authorMark: marks.get(ticket.createdBy) ?? null,
    ...authorAgentOf(ticket),
    author: ticket.createdBy,
    mine,
    lastActivity,
    held,
  };
}

/** The agent behind the author's own take on a judged ticket, if any. */
const authorAgentOf = (ticket: Ticket): { authorAgent?: string } => {
  const agent = ticket.steps.find((step) => step.owner === ticket.createdBy && isTake(step) && (step.status === "settled" || step.status === "failed") && step.agent)?.agent;
  return agent ? { authorAgent: agent } : {};
};

/** needs-you first, then waiting, failed, done; newest activity first within. */
export const compareSummaries = (first: TicketSummary, second: TicketSummary): number =>
  ORDER[first.state] - ORDER[second.state] || second.lastActivity - first.lastActivity;

/** `↻ ✓` — what has been said on the ticket, not by whom: changes were
 *  asked for, someone approved, a step failed, someone spoke. One glyph per
 *  kind of answer however many gave it, in the order that demands attention.
 *  Names were here and came out: at a glance it is what was said that
 *  matters, and "you ↻" read as the reader having asked themselves for
 *  changes. Who said what is on the ticket's page, step by step. */
export function marksLabel(summary: TicketSummary): string {
  const others = new Set<Mark>();
  for (const [who, mark] of summary.marks) if (who !== summary.author) others.add(mark);
  const said = (["changes", "failed", "approved", "spoke"] as const).filter((mark) => others.has(mark)).map((mark) => GLYPH[mark]);
  // the author's own take is attributed — "self ✓" — the one place a word
  // stays beside a glyph: a colleague's ✓ and a self-approval must not read alike
  // — and when one of their agents gave it, which: "self ✓ via Codex"
  return [...said, ...(summary.authorMark !== null ? [`self ${GLYPH[summary.authorMark]}${via(summary.authorAgent)}`] : [])].join(" ");
}

/** "2m" · "3h" · "5d" — compact, for a list column. */
export function age(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
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
