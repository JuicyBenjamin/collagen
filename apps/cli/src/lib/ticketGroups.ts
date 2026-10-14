import { epicOf, epicParts, KIND_ORDER, ticketName, type Ticket, type TicketKind } from "@collagen/p2p";
import { compareSummaries, type TicketSummary } from "./ticketSummary";

export interface Row {
  readonly ticket: Ticket;
  readonly summary: TicketSummary;
}

/** Rows drawn as a tree: a ticket under the one it waits on (`after`) or
 *  grew out of (`from`), when that one is drawn in the same place. */
export interface Stack<R extends Row> {
  readonly rows: ReadonlyArray<R>;
  /** How deep a row sits: 0 for a ticket under nothing here, one more than
   *  the ticket it is drawn under otherwise — so a chain reads as a
   *  staircase, not a flat list under its first ticket. */
  readonly depth: ReadonlyMap<string, number>;
  /** The ticket a row is drawn under — the last-drawn of those it waits on
   *  or grew out of here — when it has one. */
  readonly parent: ReadonlyMap<string, string>;
  /** The rows drawn under the ticket they grew out of (not one they wait on). */
  readonly grew: ReadonlySet<string>;
}

export interface KindGroup<R extends Row> extends Stack<R> {
  readonly kind: TicketKind;
}

export interface ProjectGroup<R extends Row> {
  readonly project: string;
  readonly kinds: ReadonlyArray<KindGroup<R>>;
}

const rank = new Map(KIND_ORDER.map((kind, index) => [kind, index]));

/** The overview's shape: a block per project, and inside it a group per
 *  kind in the order work moves through them (KIND_ORDER — proposal, bug,
 *  plan, task, review), so reading down a project is reading its pipeline.
 *
 *  Inside a group the old order stands: needs you first, then waiting,
 *  failed, done; newest activity first within. Projects are ordered the same
 *  way, by the most pressing row each holds (then by name), so a project
 *  with something for you never sinks below one without — grouping moves a
 *  row, and the ▸ and the header's count are what keep it findable. */
export function groupTickets<R extends Row>(rows: ReadonlyArray<R>): ReadonlyArray<ProjectGroup<R>> {
  const byProject = new Map<string, Array<R>>();
  for (const row of rows) byProject.set(row.ticket.project, [...(byProject.get(row.ticket.project) ?? []), row]);
  const projects = [...byProject.entries()].map(([project, mine]) => {
    const sorted = [...mine].sort((a, b) => compareSummaries(a.summary, b.summary));
    const byKind = new Map<TicketKind, Array<R>>();
    for (const row of sorted) byKind.set(row.ticket.kind, [...(byKind.get(row.ticket.kind) ?? []), row]);
    const kinds = [...byKind.entries()]
      .sort(([a], [b]) => (rank.get(a) ?? KIND_ORDER.length) - (rank.get(b) ?? KIND_ORDER.length))
      .map(([kind, rows]) => ({ kind, ...stacked(rows) }));
    return { project, kinds, lead: sorted[0]! };
  });
  return projects
    .sort((a, b) => compareSummaries(a.lead.summary, b.lead.summary) || a.project.localeCompare(b.project))
    .map(({ project, kinds }) => ({ project, kinds }));
}

/** Rows with how their tickets relate made visible: a ticket that waits on
 *  another drawn here (`after`), or grew out of one (`from`), is drawn under
 *  it, one level deeper — under the last-drawn one when there are two, so it
 *  appears once, never duplicated — after whatever is already drawn under
 *  that one. A chain is a staircase; two tickets under one are siblings at
 *  the same depth. Everything else keeps the order it came in.
 *  Deterministic: the same rows give the same drawing on every peer. A
 *  cycle (an `after` one cannot be filed, afterProblem; a `from` one should
 *  not exist) draws its rows plainly at the end. */
export function stacked<R extends Row>(sorted: ReadonlyArray<R>): Stack<R> {
  const here = new Set(sorted.map((row) => row.ticket.id));
  const preds = (row: R) => [...new Set([...(row.ticket.after ?? []), ...(row.ticket.from ?? [])])].filter((id) => here.has(id) && id !== row.ticket.id);
  const out: Array<R> = [];
  const depth = new Map<string, number>();
  const parent = new Map<string, string>();
  const grew = new Set<string>();
  const at = (id: string) => out.findIndex((placed) => placed.ticket.id === id);
  let pending = [...sorted];
  while (pending.length > 0) {
    const later: Array<R> = [];
    let moved = false;
    for (const row of pending) {
      const predecessors = preds(row);
      if (!predecessors.every((predecessor) => at(predecessor) >= 0)) {
        later.push(row);
        continue;
      }
      moved = true;
      if (predecessors.length === 0) {
        out.push(row);
        depth.set(row.ticket.id, 0);
        continue;
      }
      // under the last-drawn ticket it waits on, past everything already under that one
      const under = predecessors.reduce((last, candidate) => (at(last) >= at(candidate) ? last : candidate));
      const level = depth.get(under)! + 1;
      let position = at(under) + 1;
      while (position < out.length && depth.get(out[position]!.ticket.id)! >= level) position++;
      out.splice(position, 0, row);
      depth.set(row.ticket.id, level);
      parent.set(row.ticket.id, under);
      if (!(row.ticket.after ?? []).includes(under)) grew.add(row.ticket.id);
    }
    if (!moved) {
      for (const row of later) {
        out.push(row);
        depth.set(row.ticket.id, 0);
      }
      break;
    }
    pending = later;
  }
  return { rows: out, depth, parent, grew };
}

/** An open epic on the overview: its own row, and the tickets put in it,
 *  which are drawn here and not again in the project groups — a ticket
 *  under the one in it that it waits on or grew out of. */
export interface EpicBlock<R extends Row> extends Stack<R> {
  readonly epic: R;
}

/** Split the overview's rows into open epics, each with the tickets put in
 *  it — in the epic's reading order, then by project and state — and
 *  everything else. Membership is explicit: a ticket is in an epic only if
 *  it was put there. Epics come in the order of their most pressing row,
 *  then by goal. A ticket in a closed (or unknown) epic is drawn in its
 *  project as if it were in none. */
export function epicBlocks<R extends Row>(rows: ReadonlyArray<R>, all: ReadonlyMap<string, Ticket>): { readonly epics: ReadonlyArray<EpicBlock<R>>; readonly rest: ReadonlyArray<R> } {
  const open = new Map(rows.filter((row) => row.ticket.kind === "epic").map((row) => [row.ticket.id, { epic: row, rows: [] as Array<R> }]));
  const rest: Array<R> = [];
  for (const row of rows) {
    if (row.ticket.kind === "epic") continue;
    const block = open.get(epicOf(row.ticket) ?? "");
    if (block) block.rows.push(row);
    else rest.push(row);
  }
  // an epic is as pressing as the most pressing ticket in it
  const lead = (block: { readonly epic: R; readonly rows: ReadonlyArray<R> }): R => [block.epic, ...block.rows].reduce((best, candidate) => (compareSummaries(best.summary, candidate.summary) <= 0 ? best : candidate));
  const epics = [...open.values()]
    .map((block): EpicBlock<R> => {
      const order = epicParts(block.epic.ticket, all).parts.map((part) => part.id);
      const ordered = (latestOrder(block.epic.ticket) ?? []).length > 0;
      const rank = (row: R) => order.indexOf(row.ticket.id);
      return { epic: block.epic, ...stacked([...block.rows].sort((a, b) => (ordered ? rank(a) - rank(b) : 0) || a.ticket.project.localeCompare(b.ticket.project) || compareSummaries(a.summary, b.summary))) };
    })
    .sort((a, b) => compareSummaries(lead(a).summary, lead(b).summary) || ticketName(a.epic.ticket).localeCompare(ticketName(b.epic.ticket)));
  return { epics, rest };
}

/** The reading order someone set on an epic, if anyone did. */
const latestOrder = (epic: Ticket): ReadonlyArray<string> | undefined => epic.order?.at(-1)?.ids;

/** The rows in the order they are drawn — what ↑↓ walks: each epic, and its
 *  rows when it is unfolded, then the project groups. */
export const drawnOrder = <R extends Row>(groups: ReadonlyArray<ProjectGroup<R>>, epics: ReadonlyArray<EpicBlock<R>> = [], unfolded: ReadonlySet<string> = new Set()): ReadonlyArray<R> => [
  ...epics.flatMap((block) => [block.epic, ...(unfolded.has(block.epic.ticket.id) ? block.rows : [])]),
  ...groups.flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows)),
];

/** "proposals", "bugs" — a group's header. */
export const kindHeading = (kind: TicketKind): string => `${kind}s`;
