import { Schema } from "effect";
import { deriveThreadId } from "./topic";

// The CallScript-inspired intermediate state for cross-peer work: a ticket is
// one inert, serializable record — the goal, every step, each step's owner and
// settlement — so any peer (and any TUI) can render, resume, or audit the task
// without replaying the conversation. Peers exchange DATA only: settling a
// step is a choice the owning peer's agent makes, never something a record
// can force.

export const StepStatus = Schema.Literals(["pending", "suspended", "settled", "failed"]);
export type StepStatus = typeof StepStatus.Type;

/** Later states win a merge; ties resolve by updatedAt. */
export const STATUS_RANK: Record<StepStatus, number> = {
  pending: 0,
  suspended: 1,
  settled: 2,
  failed: 2,
};

export const TicketStep = Schema.Struct({
  id: Schema.String,
  /** Pubkey (hex) of the peer expected to settle this step. */
  owner: Schema.String,
  /** Short verb, mirrors RoomMessage.intent (e.g. "review", "investigate"). */
  intent: Schema.String,
  /** What is being asked, in full. */
  description: Schema.String,
  /** Step ids that must settle before this one is actionable. */
  needs: Schema.Array(Schema.String),
  status: StepStatus,
  /** The owning agent's findings once settled (or the failure reason). */
  result: Schema.optional(Schema.String),
  updatedAt: Schema.Finite,
});
export type TicketStep = typeof TicketStep.Type;

export const Ticket = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  goal: Schema.String,
  /** Pubkey (hex) of the creator — authoritative for the ticket's structure. */
  createdBy: Schema.String,
  steps: Schema.Array(TicketStep),
  updatedAt: Schema.Finite,
});
export type Ticket = typeof Ticket.Type;

/** Merge an incoming copy of a ticket into the local one.
 *
 *  Multi-writer rules, chosen so concurrent edits converge on every peer
 *  regardless of arrival order (join semilattice per field):
 *  - steps are unioned by id — the creator adds structure, owners never lose steps
 *  - per step, the copy with the higher status rank wins; equal ranks resolve
 *    by updatedAt, then lexicographic result as the final tiebreak
 *  - goal follows the newer updatedAt (only the creator should edit it)
 */
export function mergeTicket(local: Ticket, incoming: Ticket): Ticket {
  if (local.id !== incoming.id) return local;
  const steps = new Map<string, TicketStep>();
  for (const s of local.steps) steps.set(s.id, s);
  for (const s of incoming.steps) {
    const mine = steps.get(s.id);
    steps.set(s.id, mine ? mergeStep(mine, s) : s);
  }
  const newer = incoming.updatedAt > local.updatedAt ? incoming : local;
  return {
    ...local,
    goal: newer.goal,
    steps: [...steps.values()],
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
  };
}

function mergeStep(a: TicketStep, b: TicketStep): TicketStep {
  const ra = STATUS_RANK[a.status];
  const rb = STATUS_RANK[b.status];
  if (ra !== rb) return ra > rb ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // deterministic final tiebreak so all peers converge on the same copy
  return (a.result ?? "") >= (b.result ?? "") ? a : b;
}

/** The conversation a step belongs to. A ticket has no thread of its own:
 *  its steps ride the same threads messages use, so a step landing on your
 *  side continues the conversation you already have with that peer about
 *  that project (an adopted session resumes; a reply goes to the same place).
 *  - a step you gave a peer → the thread between the creator and that owner
 *  - a step the creator kept (typically the review at the end) → the thread
 *    with the peer whose work it waits on (first non-creator owner in `needs`)
 *  - a creator's step that waits on nobody else → the creator's own thread */
export function stepThreadId(ticket: Ticket, step: TicketStep): string {
  const creator = ticket.createdBy;
  const counterpart =
    step.owner !== creator
      ? step.owner
      : (step.needs
          .map((id) => ticket.steps.find((s) => s.id === id)?.owner)
          .find((owner): owner is string => owner !== undefined && owner !== creator) ?? creator);
  return deriveThreadId(creator, counterpart, ticket.project);
}

/** Steps a given peer should act on now: it owns them, they're not settled,
 *  and everything they depend on has settled. */
export function actionableSteps(ticket: Ticket, pubkey: string): TicketStep[] {
  const settled = new Set(ticket.steps.filter((s) => s.status === "settled").map((s) => s.id));
  return ticket.steps.filter(
    (s) =>
      s.owner === pubkey &&
      (s.status === "pending" || s.status === "suspended") &&
      s.needs.every((n) => settled.has(n)),
  );
}
