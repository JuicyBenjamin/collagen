import { isClosed, ticketName, type Ticket } from "@collagen/p2p";

// What a ticket grew from (its `from`), still open, and the person's own to
// close: when they close the ticket, whether to close those too is theirs to
// say — never closed on its own, since a review accepted is not the plan
// behind it finished.

/** The open tickets `ticket` grew from that `me` filed (so may close). */
export const openParents = (ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): ReadonlyArray<{ readonly id: string; readonly title: string }> =>
  (ticket.from ?? []).flatMap((id) => {
    const parent = all.get(id);
    return parent && parent.kind !== "epic" && parent.createdBy === me && !isClosed(parent, all) ? [{ id: parent.id, title: ticketName(parent) }] : [];
  });
