import { closedAs, epicOf, KIND_ORDER, ticketName, visibleTo, type Ticket, type TicketKind } from "@collagen/p2p";
import { cells } from "./columns";
import { ENDED, EPIC_MARK, GLYPH, KIND_GLYPH } from "./glyphs";

// The ticket list's tabs: every ticket, the ones that are yours to act on
// now, or one kind at a time — each kind's tab carrying its glyph, so the
// mark on the rows is learned from the tab.

export type TicketTab = "all" | "yours" | TicketKind;

/** "all tickets", what wants you, then the kinds in the order work moves through them. */
export const TICKET_TABS: ReadonlyArray<TicketTab> = ["all", "yours", ...KIND_ORDER];

/** A kind's glyph: an epic's crown, the others their own. */
export const kindGlyph = (kind: TicketKind): string => (kind === "epic" ? EPIC_MARK : KIND_GLYPH[kind]);

/** "all tickets", or "✦ proposals" — a kind's glyph and its plural. */
export const tabLabel = (tab: TicketTab): string => (tab === "all" ? "all tickets" : tab === "yours" ? `${GLYPH.yours} yours` : `${kindGlyph(tab)} ${tab}s`);

/** A tab that is not the open one, when the row is short of room: "all", or its glyph. */
const tabMark = (tab: TicketTab): string => (tab === "all" ? "all" : tab === "yours" ? GLYPH.yours : kindGlyph(tab));

/** Whether a ticket's row is one the typed filter keeps: every word typed is
 *  somewhere in what the row says — its title, who filed it, its project —
 *  whatever the case. Nothing typed keeps every row. */
export const keptByFilter = (typed: string, said: ReadonlyArray<string>): boolean => {
  const row = said.join("\n").toLowerCase();
  return typed.toLowerCase().split(/\s+/).filter((word) => word.length > 0).every((word) => row.includes(word));
};

/** What a ticket hangs from: the epic it is in and the ticket it grew out
 *  of — only what `me` may see: a ticket still waiting on another is its
 *  author's alone, and is neither named nor opened through another's row. */
export interface Relations {
  readonly epic?: { readonly id: string; readonly name: string };
  readonly parent?: { readonly id: string; readonly name: string };
}

const seenBy = (all: ReadonlyMap<string, Ticket>, me: string) => (ticket: Ticket | undefined): ticket is Ticket => ticket !== undefined && visibleTo(ticket, all, me);

export function relationsOf(ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): Relations {
  const seen = seenBy(all, me);
  const epicId = epicOf(ticket);
  const epic = epicId ? all.get(epicId) : undefined;
  const parent = (ticket.from ?? []).map((id) => all.get(id)).find(seen);
  return {
    ...(seen(epic) ? { epic: { id: epic.id, name: ticketName(epic) } } : {}),
    ...(parent ? { parent: { id: parent.id, name: ticketName(parent) } } : {}),
  };
}

/** A ticket's relatives by `from`, each with what it is to the ticket: the
 *  tickets it grew out of, then those that grew out of it — under the same
 *  gate as relationsOf. */
export interface Relative {
  readonly ticket: Ticket;
  readonly as: "parent" | "child";
}

export function relativesOf(ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): ReadonlyArray<Relative> {
  const seen = seenBy(all, me);
  const parents = (ticket.from ?? []).filter((id) => id !== ticket.id).map((id) => all.get(id)).filter(seen);
  const children = [...all.values()].filter((other) => other.id !== ticket.id && (other.from ?? []).includes(ticket.id) && seen(other));
  return [...parents.map((parent) => ({ ticket: parent, as: "parent" as const })), ...children.map((child) => ({ ticket: child, as: "child" as const }))];
}

/** How a closed ticket ended, as its mark (ENDED): ✓ done, ⊗ dropped. */
export const endedMark = (ticket: Ticket): string | null => {
  const as = closedAs(ticket);
  return as === null ? null : as === "dropped" ? ENDED.dropped : ENDED.done;
};

/** How a closed ticket ended, for its row: its mark, then why. */
export const closedLine = (ticket: Ticket): string | null => {
  const mark = endedMark(ticket);
  return mark === null ? null : `${mark}${ticket.closed?.reason ? ` ${ticket.closed.reason}` : ""}`;
};

/** One tab as drawn: its words, and whether it is the open one. */
export interface DrawnTab {
  readonly tab: TicketTab;
  readonly text: string;
  readonly open: boolean;
}

/** The tabs as a row of `width` columns, the open one always whole with its
 *  count: every tab named when they fit, an empty kind too; else the others
 *  by glyph and count; else a window of them
 *  around the open one, a ‹ or › where some are cut off. */
export function fitTabs(tab: TicketTab, counts: ReadonlyMap<TicketTab, number>, width: number | undefined): { readonly tabs: ReadonlyArray<DrawnTab>; readonly gap: number; readonly before: boolean; readonly after: boolean } {
  const countOf = (ticketTab: TicketTab) => counts.get(ticketTab) ?? 0;
  const full = TICKET_TABS.map((ticketTab): DrawnTab => ({ tab: ticketTab, open: ticketTab === tab, text: `${tabLabel(ticketTab)} ${countOf(ticketTab)}` }));
  const short = TICKET_TABS.map((ticketTab): DrawnTab => ({ tab: ticketTab, open: ticketTab === tab, text: ticketTab === tab ? `${tabLabel(ticketTab)} ${countOf(ticketTab)}` : `${tabMark(ticketTab)} ${countOf(ticketTab)}` }));
  const span = (row: ReadonlyArray<DrawnTab>, gap: number) => row.reduce((total, drawn, index) => total + cells(drawn.text) + (index > 0 ? gap : 0), 0);
  if (width === undefined || span(full, 3) <= width) return { tabs: full, gap: 3, before: false, after: false };
  if (span(short, 2) <= width) return { tabs: short, gap: 2, before: false, after: false };
  // a window around the open tab, grown a neighbour at a time while it fits beside its marks
  const at = TICKET_TABS.indexOf(tab);
  let from = at;
  let to = at;
  const fits = (first: number, last: number) => span(short.slice(first, last + 1), 2) + (first > 0 ? 2 : 0) + (last < short.length - 1 ? 2 : 0) <= width;
  for (let grew = true; grew; ) {
    grew = false;
    if (to < short.length - 1 && fits(from, to + 1)) (to++, (grew = true));
    if (from > 0 && fits(from - 1, to)) (from--, (grew = true));
  }
  return { tabs: short.slice(from, to + 1), gap: 2, before: from > 0, after: to < short.length - 1 };
}
