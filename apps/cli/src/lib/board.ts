import { BOARD_COLUMNS, boardColumn, heldBy, visibleTo, type BoardColumn, type RoomMessage, type Ticket, type Unseen } from "@collagen/p2p";
import { compareSummaries, summarize } from "./ticketSummary";
import type { Row } from "./ticketGroups";

/** One column of the board, its tickets in the order the lists use. */
export interface Lane {
  readonly column: BoardColumn;
  readonly rows: ReadonlyArray<Row>;
}

/** The room's tickets as one reader's board: to do, in progress, done
 *  (p2p boardColumn — the terminal and the app both ask it). Only what this
 *  reader may be shown; in each column what wants them first, then newest
 *  activity, as the ticket list orders them — so in done, a finished ticket
 *  still open sits above the closed ones. */
export function boardOf(tickets: ReadonlyArray<Ticket>, messages: ReadonlyArray<RoomMessage>, me: string): ReadonlyArray<Lane> {
  const all = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const rows = tickets
    .filter((ticket) => visibleTo(ticket, all, me))
    .map((ticket) => ({ ticket, summary: summarize(ticket, messages, me, heldBy(ticket, all), all), column: boardColumn(ticket, all) }));
  return BOARD_COLUMNS.map((column) => ({
    column,
    rows: rows
      .filter((row) => row.column === column)
      .sort((first, second) => compareSummaries(first.summary, second.summary))
      .map(({ ticket, summary }) => ({ ticket, summary })),
  }));
}

/** How many tickets a newer collagen wrote here that this build cannot
 *  read: the board cannot place them, so it says they are there. */
export const unreadTickets = (unseen: ReadonlyArray<Unseen>): number => unseen.filter((entry) => entry.key.startsWith("ticket/")).length;

/** The line the board ends with when there are any. */
export const unreadLine = (count: number): string => `update collagen to see ${count} more ticket${count === 1 ? "" : "s"}`;
