import type { Ticket } from "@collagen/p2p";

/** A ticket as the agent reads it: keys resolved to names, needs joined. */
export const ticketView = (ticket: Ticket, nameFor: (key: string) => string) => ({
  id: ticket.id,
  project: ticket.project,
  goal: ticket.goal,
  createdBy: nameFor(ticket.createdBy),
  steps: ticket.steps.map((s) => ({
    id: s.id,
    owner: nameFor(s.owner),
    intent: s.intent,
    status: s.status,
    needs: s.needs.join("+"),
    description: s.description,
    result: s.result ?? "",
  })),
});
