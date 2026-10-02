import { epicHome, isClosed, type Ticket } from "@collagen/p2p";

/** How recent "filed together" is, for the epic offer. */
const TOGETHER_MS = 30 * 60_000;

/** When a person files several related tickets together and none is in an
 *  epic, their agent is asked to OFFER one — once, in a line, on their yes.
 *  Related: grown out of the same ticket (or out of it), or filed in the same
 *  project within the last half hour. Three of them make the offer. */
export function relatedHint(ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): string {
  if (ticket.kind === "epic" || epicHome(ticket, all) !== null) return "";
  const parents = new Set(ticket.from ?? []);
  const related = [...all.values()].filter(
    (t) =>
      t.id !== ticket.id &&
      t.kind !== "epic" &&
      t.createdBy === me &&
      !isClosed(t) &&
      epicHome(t, all) === null &&
      (parents.has(t.id) || (t.from ?? []).some((p) => parents.has(p) || p === ticket.id) || (t.project === ticket.project && ticket.structureAt - t.structureAt < TOGETHER_MS && t.structureAt <= ticket.structureAt)),
  );
  if (related.length < 2) return "";
  return ` RELATED: your user has filed ${related.length + 1} related tickets together (${[ticket, ...related].map((t) => t.id).join(", ")}) and none is in an epic. After reporting the filing, offer them in one line to put these under one epic (epic, action create, with these ticketIds) — only on their yes, and not again if they decline.`;
}
