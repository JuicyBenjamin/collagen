import type { Peer } from "@collagen/p2p";
import type { JobView } from "../services/Jobs";

// What is running on a ticket right now: the person's own jobs and those a
// peer shares while they run (their profile's `running`), merged, so the
// ticket's row and its review page say the same. Pure.

/** One job running on a ticket: whose, how far it says it is, since when. */
export interface RunningOn {
  readonly who: string;
  readonly kind: string;
  readonly step?: number;
  readonly of?: number;
  readonly doing?: string;
  readonly since: number;
}

/** Every job running on `ticketId`, the person's own first, then each peer's, the longest running first. */
export const runningOn = (ticketId: string, own: ReadonlyArray<JobView>, peers: ReadonlyArray<Peer>): ReadonlyArray<RunningOn> => {
  const mine = own
    .filter((view) => view.state === "running" && (view.onTicket ?? view.ticketId) === ticketId)
    .map((view): RunningOn => ({ who: "you", kind: view.kind, since: view.startedAt ?? view.queuedAt, ...(view.progress ? { step: view.progress.step, doing: view.progress.doing, ...(view.progress.of !== undefined ? { of: view.progress.of } : {}) } : {}) }));
  const theirs = peers.flatMap((peer) => (peer.running ?? []).filter((job) => job.ticketId === ticketId).map((job): RunningOn => ({ who: peer.name, ...job })));
  return [...mine, ...theirs].sort((first, second) => first.since - second.since);
};

/** The braille spinner a running row turns through, one cell wide. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** A ticket's running jobs in a few cells: how far the first says it is, and how many run. */
export const runningShort = (running: ReadonlyArray<RunningOn>, frame: string): string | null => {
  const first = running[0];
  if (!first) return null;
  const far = first.step !== undefined && first.of !== undefined ? `${first.step}/${first.of}` : "running";
  return `${frame} ${far}${running.length > 1 ? ` · ${running.length} running` : ""}`;
};
