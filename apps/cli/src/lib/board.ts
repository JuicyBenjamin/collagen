import { BOARD_COLUMNS, boardColumn, epicOf, heldBy, visibleTo, type BoardColumn, type RoomMessage, type Ticket, type TicketKind, type Unseen } from "@collagen/p2p";
import { compareSummaries, summarize } from "./ticketSummary";
import type { Row } from "./ticketGroups";

/** One column of the board, its tickets in the order the lists use, those
 *  that grew from one another stacked together. */
export interface Lane {
  readonly column: BoardColumn;
  /** each a line of work — what grew from what — the newest on top */
  readonly stacks: ReadonlyArray<ReadonlyArray<Row>>;
  /** the stacks one after another: the order a cursor walks */
  readonly rows: ReadonlyArray<Row>;
  /** done tickets left off, finished before the recent ones */
  readonly older: number;
}

/** Which board: everything, or one epic's; and whether the done column shows all it has. */
export interface BoardView {
  /** an epic's id: only its tickets */
  readonly epic?: string | null;
  /** every done ticket, not only the recent ones */
  readonly allDone?: boolean;
  /** only tickets of these kinds; none or empty: every kind */
  readonly kinds?: ReadonlyArray<TicketKind>;
  readonly now: number;
}

/** How long a done ticket stays on the board: no sprints, so the done
 *  column is what finished lately, the rest counted. */
export const RECENT_DAYS = 14;
const DAY = 86_400_000;

/** When a done ticket finished: its close, else its last move. */
const finishedAt = (ticket: Ticket): number => ticket.closed?.ts ?? ticket.updatedAt;

/** The ticket a line of work began with: what it grew from, and that from,
 *  among the tickets shown. */
const rootOf = (ticket: Ticket, shown: ReadonlyMap<string, Ticket>): Ticket => {
  const seen = new Set([ticket.id]);
  let at = ticket;
  for (;;) {
    const parent = (at.from ?? []).map((id) => shown.get(id)).find((candidate) => candidate !== undefined && !seen.has(candidate.id));
    if (!parent) return at;
    seen.add(parent.id);
    at = parent;
  }
};

/** How far down its line of work a ticket is: what it grew from, counted. */
const depthOf = (ticket: Ticket, shown: ReadonlyMap<string, Ticket>): number => {
  let depth = 0;
  const seen = new Set([ticket.id]);
  let at = ticket;
  for (;;) {
    const parent = (at.from ?? []).map((id) => shown.get(id)).find((candidate) => candidate !== undefined && !seen.has(candidate.id));
    if (!parent) return depth;
    seen.add(parent.id);
    at = parent;
    depth++;
  }
};

/** The room's tickets as one reader's board: to do, in progress, done
 *  (p2p boardColumn — the terminal and the app both ask it). Only what this
 *  reader may be shown; epics are not on it — they are the views it is read
 *  through, all of it or one epic's. In each column what wants them first,
 *  then newest activity, as the ticket list orders them; tickets that grew
 *  from one another stacked where the first of them stands, the latest on
 *  top. Done holds what finished in the last RECENT_DAYS, the rest counted. */
export function boardOf(tickets: ReadonlyArray<Ticket>, messages: ReadonlyArray<RoomMessage>, me: string, view: BoardView = { now: Date.now() }): ReadonlyArray<Lane> {
  const all = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  // what a line of work is made of: everything in the view; a kind filter
  // then keeps only some of its cards, still stacked as the line they are in
  const lines = new Map(
    tickets
      .filter((ticket) => ticket.kind !== "epic" && visibleTo(ticket, all, me) && (view.epic ? epicOf(ticket) === view.epic : true))
      .map((ticket) => [ticket.id, ticket]),
  );
  const kinds = view.kinds ?? [];
  const shown = [...lines.values()].filter((ticket) => kinds.length === 0 || kinds.includes(ticket.kind));
  const rows = shown.map((ticket) => ({ ticket, summary: summarize(ticket, messages, me, heldBy(ticket, all, me), all), column: boardColumn(ticket, all) }));
  return BOARD_COLUMNS.map((column) => {
    const inColumn = rows.filter((row) => row.column === column).sort((first, second) => compareSummaries(first.summary, second.summary));
    const recent = column === "done" && !view.allDone ? inColumn.filter((row) => finishedAt(row.ticket) >= view.now - RECENT_DAYS * DAY) : inColumn;
    // a stack stands where its first ticket in the order does; inside it, the furthest down its line on top
    const byRoot = new Map<string, Array<Row>>();
    for (const { ticket, summary } of recent) {
      const root = rootOf(ticket, lines).id;
      byRoot.set(root, [...(byRoot.get(root) ?? []), { ticket, summary }]);
    }
    const stacks = [...byRoot.values()].map((stack) => [...stack].sort((first, second) => depthOf(second.ticket, lines) - depthOf(first.ticket, lines) || second.ticket.updatedAt - first.ticket.updatedAt));
    return { column, stacks, rows: stacks.flat(), older: inColumn.length - recent.length };
  });
}

/** How many of each kind a board shows, read without a kind filter: what
 *  each kind's filter would leave. */
export const kindCounts = (lanes: ReadonlyArray<Lane>): ReadonlyMap<TicketKind, number> => {
  const counts = new Map<TicketKind, number>();
  for (const row of lanes.flatMap((lane) => lane.rows)) counts.set(row.ticket.kind, (counts.get(row.ticket.kind) ?? 0) + 1);
  return counts;
};

/** The epics a reader can read the board through: those with a ticket
 *  still to do or in progress that they may be shown, the most open first. */
export function boardEpics(tickets: ReadonlyArray<Ticket>, me: string): ReadonlyArray<{ readonly epic: Ticket; readonly open: number }> {
  const all = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return tickets
    .filter((ticket) => ticket.kind === "epic" && visibleTo(ticket, all, me))
    .map((epic) => ({ epic, open: tickets.filter((ticket) => ticket.kind !== "epic" && epicOf(ticket) === epic.id && visibleTo(ticket, all, me) && boardColumn(ticket, all) !== "done").length }))
    .filter((entry) => entry.open > 0)
    .sort((first, second) => second.open - first.open || (first.epic.title ?? first.epic.goal).localeCompare(second.epic.title ?? second.epic.goal));
}

/** How many tickets a newer collagen wrote here that this build cannot
 *  read: the board cannot place them, so it says they are there. */
export const unreadTickets = (unseen: ReadonlyArray<Unseen>): number => unseen.filter((entry) => entry.key.startsWith("ticket/")).length;

/** The line the board ends with when there are any. */
export const unreadLine = (count: number): string => `update collagen to see ${count} more ticket${count === 1 ? "" : "s"}`;
