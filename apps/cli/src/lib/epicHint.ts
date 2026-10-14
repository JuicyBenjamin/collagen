import { epicOf, isClosed, ticketName, type Ticket } from "@collagen/p2p";

/** How many tickets a lineage needs before a new epic is worth asking about. */
const CLUSTER = 4;
/** The most open epics named as candidates for a new ticket. */
const EPICS_SHOWN = 6;

/** What the agent is told about epics as a ticket is filed — candidates for
 *  it to JUDGE, never an instruction to ask: collagen has no model and
 *  cannot tell whether tickets share a topic, so the agent decides, and says
 *  nothing unless the topics plainly match. A ticket grown out of a part of
 *  one epic is filed into it (epicForFiling), so it needs no word. Three
 *  kinds, in this order:
 *    - it grows out of tickets in several epics: a choice of them;
 *    - your own open tickets share its lineage (grown out of the same
 *      ticket, or out of it) and there are CLUSTER of them, none in an epic:
 *      a new epic for them;
 *    - otherwise, the room's open epics, for a ticket that plainly belongs
 *      to one.
 *  Never put there on its own; once, in a line, on the person's yes. Being
 *  filed close together, or in one project, proves nothing about a topic. */
export function relatedHint(ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): string {
  if (ticket.kind === "epic" || epicOf(ticket) !== null) return "";
  const judge = "Only if they are plainly about the same topic — otherwise say nothing about epics at all.";
  // grown out of a ticket in an epic: that epic is the candidate, not a new one
  const parentEpics = [...new Set((ticket.from ?? []).map((id) => all.get(id)).flatMap((parent) => (parent && epicOf(parent) ? [epicOf(parent)!] : [])))].flatMap((id) => {
    const epic = all.get(id);
    return epic && epic.kind === "epic" && !isClosed(epic, all) ? [epic] : [];
  });
  // grown out of a part of one epic yet not in it: its filer kept it out
  if (parentEpics.length === 1) return "";
  if (parentEpics.length > 1) {
    return ` EPIC: it grows out of tickets in ${parentEpics.length} epics (${parentEpics.map((epic) => `"${ticketName(epic)}" [${epic.id}]`).join(", ")}). If it plainly belongs to one, ask your user in one line which (epic, action add). ${judge}`;
  }
  // one lineage: grown out of the same ticket as this one, or out of this one
  const parents = new Set(ticket.from ?? []);
  const lineage = [...all.values()].filter(
    (other) =>
      other.id !== ticket.id &&
      other.kind !== "epic" &&
      other.createdBy === me &&
      !isClosed(other) &&
      epicOf(other) === null &&
      (parents.has(other.id) || (other.from ?? []).some((parentId) => parents.has(parentId) || parentId === ticket.id)),
  );
  if (lineage.length + 1 >= CLUSTER) {
    const named = [ticket, ...lineage].map((member) => `"${ticketName(member)}" [${member.id}]`).join(", ");
    return ` RELATED: ${lineage.length + 1} of your user's open tickets share one lineage and none is in an epic: ${named}. If together they are one body of work, offer in one line to put them under one epic (epic, action create, with their ticketIds) — only on their yes, and not again if they decline. ${judge}`;
  }
  // the room's open epics, for a ticket that plainly fits one
  const epics = [...all.values()].filter((epic) => epic.kind === "epic" && !isClosed(epic, all)).slice(0, EPICS_SHOWN);
  if (epics.length === 0) return "";
  return ` EPICS open in the room: ${epics.map((epic) => `"${ticketName(epic)}" [${epic.id}]`).join(", ")}. If this ticket plainly belongs to one, ask your user in one line whether to add it (epic, action add). ${judge}`;
}
