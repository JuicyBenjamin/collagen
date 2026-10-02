import { epicOf, isClosed, type Ticket } from "@collagen/p2p";

/** How recent "filed together" is, for the epic offer. */
const TOGETHER_MS = 30 * 60_000;

/** What the agent is asked to offer about epics as a ticket is filed: the
 *  epic of the ticket it grows out of (one, or a choice of several) — never
 *  put there on its own — or, when the person files several related tickets
 *  together and none is in an epic, a new one. Once, in a line, on their yes.
 *  Related: grown out of the same ticket (or out of it), or filed in the same
 *  project within the last half hour. Three of them make the offer. */
export function relatedHint(ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): string {
  if (ticket.kind === "epic" || epicOf(ticket) !== null) return "";
  // grown out of a ticket in an epic: that epic is the suggestion, not a new one
  const parentEpics = [...new Set((ticket.from ?? []).map((id) => all.get(id)).flatMap((p) => (p && epicOf(p) ? [epicOf(p)!] : [])))].flatMap((id) => {
    const e = all.get(id);
    return e && e.kind === "epic" && !isClosed(e, all) ? [e] : [];
  });
  if (parentEpics.length === 1) {
    const e = parentEpics[0]!;
    return ` EPIC: it grows out of a ticket in the epic "${e.goal}" [${e.id}]. Ask your user in one line whether this one belongs there too (epic, action add) — it is not put there on its own.`;
  }
  if (parentEpics.length > 1) {
    return ` EPIC: it grows out of tickets in ${parentEpics.length} epics (${parentEpics.map((e) => `"${e.goal}" [${e.id}]`).join(", ")}). Ask your user in one line which, if any, this one belongs to (epic, action add).`;
  }
  const parents = new Set(ticket.from ?? []);
  const related = [...all.values()].filter(
    (t) =>
      t.id !== ticket.id &&
      t.kind !== "epic" &&
      t.createdBy === me &&
      !isClosed(t) &&
      epicOf(t) === null &&
      (parents.has(t.id) || (t.from ?? []).some((p) => parents.has(p) || p === ticket.id) || (t.project === ticket.project && ticket.structureAt - t.structureAt < TOGETHER_MS && t.structureAt <= ticket.structureAt)),
  );
  if (related.length < 2) return "";
  return ` RELATED: your user has filed ${related.length + 1} related tickets together (${[ticket, ...related].map((t) => t.id).join(", ")}) and none is in an epic. After reporting the filing, offer them in one line to put these under one epic (epic, action create, with these ticketIds) — only on their yes, and not again if they decline.`;
}
