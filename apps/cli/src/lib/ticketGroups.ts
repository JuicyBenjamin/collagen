import { KIND_ORDER, type Ticket, type TicketKind } from "@collagen/p2p";
import { compareSummaries, type TicketSummary } from "./ticketSummary";

export interface Row {
  readonly t: Ticket;
  readonly s: TicketSummary;
}

export interface KindGroup<R extends Row> {
  readonly kind: TicketKind;
  readonly rows: ReadonlyArray<R>;
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
      .map(([kind, rows]) => ({ kind, rows }));
    return { project, kinds, lead: sorted[0]! };
  });
  return projects
    .sort((a, b) => compareSummaries(a.lead.s, b.lead.s) || a.project.localeCompare(b.project))
    .map(({ project, kinds }) => ({ project, kinds }));
}

/** The rows in the order they are drawn — what ↑↓ walks. */
export const drawnOrder = <R extends Row>(groups: ReadonlyArray<ProjectGroup<R>>): ReadonlyArray<R> =>
  groups.flatMap((g) => g.kinds.flatMap((k) => k.rows));

/** "proposals", "bugs" — a group's header. */
export const kindHeading = (kind: TicketKind): string => `${kind}s`;
