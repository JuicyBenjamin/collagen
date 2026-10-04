import { closedAs, epicOf, KIND_ORDER, ticketName, visibleTo, type Ticket, type TicketKind } from "@collagen/p2p";
import { EPIC_MARK, KIND_GLYPH } from "./glyphs";

// The ticket list's tabs: every ticket, or one kind at a time — each kind's
// tab carrying its glyph, so the mark on the rows is learned from the tab.

export type TicketTab = "all" | TicketKind;

/** The tabs in the order work moves through the kinds, after "all tickets". */
export const TICKET_TABS: ReadonlyArray<TicketTab> = ["all", ...KIND_ORDER];

/** A kind's glyph: an epic's crown, the others their own. */
export const kindGlyph = (kind: TicketKind): string => (kind === "epic" ? EPIC_MARK : KIND_GLYPH[kind]);

/** "all tickets", or "✦ proposals" — a kind's glyph and its plural. */
export const tabLabel = (tab: TicketTab): string => (tab === "all" ? "all tickets" : `${kindGlyph(tab)} ${tab}s`);

/** What a ticket hangs from, for a row to say quietly: the epic it is in,
 *  the ticket it grew out of, and how many grew out of it — only what `me`
 *  may see: a ticket still waiting on another is its author's alone, and is
 *  neither named, counted nor opened through another's row. */
export interface Relations {
  readonly epic?: { readonly id: string; readonly name: string };
  readonly parent?: { readonly id: string; readonly name: string };
  readonly children: number;
}

export function relationsOf(t: Ticket, all: ReadonlyMap<string, Ticket>, me: string): Relations {
  const seen = (x: Ticket | undefined): x is Ticket => x !== undefined && visibleTo(x, all, me);
  const e = epicOf(t);
  const epic = e ? all.get(e) : undefined;
  const p = (t.from ?? []).map((id) => all.get(id)).find(seen);
  const children = [...all.values()].filter((x) => x.id !== t.id && (x.from ?? []).includes(t.id) && seen(x)).length;
  return {
    ...(seen(epic) ? { epic: { id: epic.id, name: ticketName(epic) } } : {}),
    ...(p ? { parent: { id: p.id, name: ticketName(p) } } : {}),
    children,
  };
}

/** How a closed ticket ended, for its row: "done", or "dropped" with why. */
export const closedLine = (t: Ticket): string | null => {
  const as = closedAs(t);
  if (as === null) return null;
  return `${as === "dropped" ? "dropped" : "closed as done"}${t.closed?.reason ? `: ${t.closed.reason}` : ""}`;
};
