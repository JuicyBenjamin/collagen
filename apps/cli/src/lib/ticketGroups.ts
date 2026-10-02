import { KIND_ORDER, type Ticket, type TicketKind } from "@collagen/p2p";
import { compareSummaries, type TicketSummary } from "./ticketSummary";

export interface Row {
  readonly t: Ticket;
  readonly s: TicketSummary;
}

export interface KindGroup<R extends Row> {
  readonly kind: TicketKind;
  readonly rows: ReadonlyArray<R>;
  /** How deep a row sits in its group's stack (`after`): 0 for a ticket
   *  that waits on nothing here, one more than the ticket it is drawn under
   *  otherwise — so a chain reads as a staircase, not a flat list under its
   *  first ticket. */
  readonly depth: ReadonlyMap<string, number>;
  /** The ticket a row is drawn under — the last-drawn of those it waits on
   *  in this group — when it has one. */
  readonly parent: ReadonlyMap<string, string>;
}

export interface ProjectGroup<R extends Row> {
  readonly project: string;
  readonly kinds: ReadonlyArray<KindGroup<R>>;
}

const rank = new Map(KIND_ORDER.map((k, i) => [k, i]));

/** The overview's shape: a block per project, and inside it a group per
 *  kind in the order work moves through them (KIND_ORDER — proposal, plan,
 *  bug, review, task), so reading down a project is reading its pipeline.
 *
 *  Inside a group the old order stands: needs you first, then waiting,
 *  failed, done; newest activity first within. Projects are ordered the same
 *  way, by the most pressing row each holds (then by name), so a project
 *  with something for you never sinks below one without — grouping moves a
 *  row, and the ▸ and the header's count are what keep it findable. */
export function groupTickets<R extends Row>(rows: ReadonlyArray<R>): ReadonlyArray<ProjectGroup<R>> {
  const byProject = new Map<string, Array<R>>();
  for (const r of rows) byProject.set(r.t.project, [...(byProject.get(r.t.project) ?? []), r]);
  const projects = [...byProject.entries()].map(([project, mine]) => {
    const sorted = [...mine].sort((a, b) => compareSummaries(a.s, b.s));
    const byKind = new Map<TicketKind, Array<R>>();
    for (const r of sorted) byKind.set(r.t.kind, [...(byKind.get(r.t.kind) ?? []), r]);
    const kinds = [...byKind.entries()]
      .sort(([a], [b]) => (rank.get(a) ?? KIND_ORDER.length) - (rank.get(b) ?? KIND_ORDER.length))
      .map(([kind, rows]) => ({ kind, ...stacked(rows) }));
    return { project, kinds, lead: sorted[0]! };
  });
  return projects
    .sort((a, b) => compareSummaries(a.lead.s, b.lead.s) || a.project.localeCompare(b.project))
    .map(({ project, kinds }) => ({ project, kinds }));
}

/** A group's rows with the order its tickets keep (`after`) made visible:
 *  a ticket that waits on another in the same group is drawn under it, one
 *  level deeper — under the last-drawn one when it waits on two, so it
 *  appears once, never duplicated — after whatever is already drawn under
 *  that one. A chain is a staircase; two tickets waiting on one are siblings
 *  at the same depth. Everything else keeps the state order it came in.
 *  Deterministic: the same rows give the same drawing on every peer. A
 *  cycle cannot be filed (afterProblem); should one arrive anyway, its rows
 *  are drawn plainly at the end. */
function stacked<R extends Row>(sorted: ReadonlyArray<R>): { rows: ReadonlyArray<R>; depth: ReadonlyMap<string, number>; parent: ReadonlyMap<string, string> } {
  const here = new Set(sorted.map((r) => r.t.id));
  const preds = (r: R) => (r.t.after ?? []).filter((id) => here.has(id) && id !== r.t.id);
  const out: Array<R> = [];
  const depth = new Map<string, number>();
  const parent = new Map<string, string>();
  const at = (id: string) => out.findIndex((o) => o.t.id === id);
  let pending = [...sorted];
  while (pending.length > 0) {
    const later: Array<R> = [];
    let moved = false;
    for (const r of pending) {
      const ps = preds(r);
      if (!ps.every((p) => at(p) >= 0)) {
        later.push(r);
        continue;
      }
      moved = true;
      if (ps.length === 0) {
        out.push(r);
        depth.set(r.t.id, 0);
        continue;
      }
      // under the last-drawn ticket it waits on, past everything already under that one
      const under = ps.reduce((a, b) => (at(a) >= at(b) ? a : b));
      const d = depth.get(under)! + 1;
      let i = at(under) + 1;
      while (i < out.length && depth.get(out[i]!.t.id)! >= d) i++;
      out.splice(i, 0, r);
      depth.set(r.t.id, d);
      parent.set(r.t.id, under);
    }
    if (!moved) {
      for (const r of later) {
        out.push(r);
        depth.set(r.t.id, 0);
      }
      break;
    }
    pending = later;
  }
  return { rows: out, depth, parent };
}

/** The rows in the order they are drawn — what ↑↓ walks. */
export const drawnOrder = <R extends Row>(groups: ReadonlyArray<ProjectGroup<R>>): ReadonlyArray<R> =>
  groups.flatMap((g) => g.kinds.flatMap((k) => k.rows));

/** "proposals", "bugs" — a group's header. */
export const kindHeading = (kind: TicketKind): string => `${kind}s`;
