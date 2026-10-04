import { closedAs, epicOf, KIND_ORDER, ticketName, visibleTo, type Ticket, type TicketKind } from "@collagen/p2p";
import { cells } from "./columns";
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

/** One tab as drawn: its words, and whether it is the open one. */
export interface DrawnTab {
  readonly tab: TicketTab;
  readonly text: string;
  readonly open: boolean;
}

/** The tabs as a row of `width` columns, the open one always whole with its
 *  count: every tab named when they fit (a kind with nothing open by its
 *  glyph alone); else the others by glyph and count; else a window of them
 *  around the open one, a ‹ or › where some are cut off. */
export function fitTabs(tab: TicketTab, counts: ReadonlyMap<TicketTab, number>, width: number | undefined): { readonly tabs: ReadonlyArray<DrawnTab>; readonly gap: number; readonly before: boolean; readonly after: boolean } {
  const n = (t: TicketTab) => counts.get(t) ?? 0;
  const full = TICKET_TABS.map((t): DrawnTab => ({ tab: t, open: t === tab, text: `${t === tab || n(t) > 0 || t === "all" ? tabLabel(t) : kindGlyph(t)} ${n(t)}` }));
  const short = TICKET_TABS.map((t): DrawnTab => ({ tab: t, open: t === tab, text: t === tab ? `${tabLabel(t)} ${n(t)}` : `${t === "all" ? "all" : kindGlyph(t)} ${n(t)}` }));
  const span = (row: ReadonlyArray<DrawnTab>, gap: number) => row.reduce((w, d, i) => w + cells(d.text) + (i > 0 ? gap : 0), 0);
  if (width === undefined || span(full, 3) <= width) return { tabs: full, gap: 3, before: false, after: false };
  if (span(short, 2) <= width) return { tabs: short, gap: 2, before: false, after: false };
  // a window around the open tab, grown a neighbour at a time while it fits beside its marks
  const at = TICKET_TABS.indexOf(tab);
  let from = at;
  let to = at;
  const fits = (a: number, b: number) => span(short.slice(a, b + 1), 2) + (a > 0 ? 2 : 0) + (b < short.length - 1 ? 2 : 0) <= width;
  for (let grew = true; grew; ) {
    grew = false;
    if (to < short.length - 1 && fits(from, to + 1)) (to++, (grew = true));
    if (from > 0 && fits(from - 1, to)) (from--, (grew = true));
  }
  return { tabs: short.slice(from, to + 1), gap: 2, before: from > 0, after: to < short.length - 1 };
}
