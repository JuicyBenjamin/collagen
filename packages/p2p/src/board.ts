import { epicParts, finished, isClosed, outOfProgress, type Ticket } from "./ticket";

// The room's tickets as a board — to do, in progress, done. A ticket's
// column is derived from its record, never stored: the terminal and the
// app both ask here, so a ticket never sits in two columns at once.

export type BoardColumn = "todo" | "doing" | "done";

/** The columns, left to right: the order work moves through them. */
export const BOARD_COLUMNS: ReadonlyArray<BoardColumn> = ["todo", "doing", "done"];

/** A column's heading, the same words on every screen. */
export const BOARD_LABEL: Record<BoardColumn, string> = { todo: "to do", doing: "in progress", done: "done" };

/** Has anyone started on it: a step handed to its owner's agent
 *  (suspended), answered or failed. A retired step is the author taking work
 *  back, not anyone doing it. */
const started = (ticket: Ticket): boolean => ticket.steps.some((step) => step.status === "suspended" || step.status === "settled" || step.status === "failed");

/** Which column a ticket is in:
 *  - done: closed (done or dropped — either way it is over), or every step
 *    answered (finished, its author not having closed it yet);
 *  - in progress: a step was taken up — delivered, answered or failed;
 *  - to do: otherwise — no steps yet, or none taken up.
 *  An epic by the parts it counts: done when closed, or when every one is
 *  done; in progress once any is past to do; to do before that — a part
 *  dropped or excluded is no one starting it. Pass
 *  the room's tickets: an epic's state is its parts'. */
export function boardColumn(ticket: Ticket, all: ReadonlyMap<string, Ticket>): BoardColumn {
  if (isClosed(ticket, all)) return "done";
  if (ticket.kind === "epic") {
    const { parts, counted, done } = epicParts(ticket, all);
    if (counted > 0 && done === counted) return "done";
    return parts.some((part) => !outOfProgress(part) && boardColumn(part, all) !== "todo") ? "doing" : "todo";
  }
  if (finished(ticket)) return "done";
  return started(ticket) ? "doing" : "todo";
}
