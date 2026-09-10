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
  /** Pubkey (hex) of the peer expected to settle this step. Always a person:
   *  a step nobody is doing does not exist. */
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

/** What kind of work the ticket is. "task" is the plain one: a goal and its
 *  steps. A "review" carries the why behind a change as well (see review.ts)
 *  — the reviewer reads the decisions and the forks, not only the diff. */
export const TicketKind = Schema.Literals(["task", "review"]);
export type TicketKind = typeof TicketKind.Type;

export const Ticket = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  goal: Schema.String,
  /** Pubkey (hex) of the creator — authoritative for the ticket's structure. */
  createdBy: Schema.String,
  kind: TicketKind,
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
    kind: newer.kind,
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
  const named = (owner: string | undefined): owner is string => owner !== undefined && owner !== creator;
  const counterpart = named(step.owner)
    ? step.owner
    : (step.needs.map((id) => ticket.steps.find((s) => s.id === id)?.owner).find(named) ?? creator);
  return deriveThreadId(creator, counterpart, ticket.project);
}

/** The step id a reader's own review lands on. Reviewing never takes another
 *  person's step and never closes an invitation: it adds a step of your own,
 *  attributed to you, so a second and a third reader can review the same
 *  change. Reviewing again reuses your id — that is how you revise. Two
 *  people with the same display name are told apart by their key. */
export const reviewStepId = (name: string, key: string, taken: ReadonlyMap<string, string>): string => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "peer";
  const base = `review-${slug}`;
  const owner = taken.get(base);
  return owner === undefined || owner === key ? base : `${base}-${key.slice(0, 4)}`;
};

export type SettleOutcome =
  /** the step was yours: settled (or failed) in place */
  | "settled"
  /** someone else's step: refused, nothing changed (say it with a message, or
   *  post your own review — see `postReview`) */
  | "not-yours";

export interface Settlement {
  readonly ticket: Ticket;
  readonly outcome: SettleOutcome;
}

/** Settling a step, as one rule for every caller (the app's Dispatch and the
 *  test drive alike — two implementations of this drifted apart once). A step
 *  belongs to the person who owns it: nobody else settles it, on any kind of
 *  ticket. Returns null when there is no such step. */
export function settleStep(
  ticket: Ticket,
  stepId: string,
  by: string,
  result: string,
  failed: boolean,
  now: number,
): Settlement | null {
  const step = ticket.steps.find((s) => s.id === stepId);
  if (!step) return null;
  if (step.owner !== by) return { ticket, outcome: "not-yours" };
  const status = failed ? ("failed" as const) : ("settled" as const);
  return {
    ticket: {
      ...ticket,
      updatedAt: now,
      steps: ticket.steps.map((s) => (s.id === stepId ? { ...s, status, result, updatedAt: now } : s)),
    },
    outcome: "settled",
  };
}

/** A review, posted by whoever read the change — the peer who was asked, or
 *  one who was not. It lands on a step of their own (`review-<them>`), so a
 *  second and a third reader can review the same change without taking
 *  anything from each other, and posting again revises your own. This is why
 *  a review ticket needs no placeholder step for "somebody, eventually": a
 *  step exists when a person has something on it. */
export function postReview(
  ticket: Ticket,
  by: { readonly key: string; readonly name: string },
  findings: string,
  failed: boolean,
  now: number,
): { readonly ticket: Ticket; readonly stepId: string } {
  const id = reviewStepId(by.name, by.key, new Map(ticket.steps.map((s) => [s.id, s.owner])));
  const existing = ticket.steps.find((s) => s.id === id);
  const step: TicketStep = {
    id,
    owner: by.key,
    intent: "review",
    description: existing?.description ?? `${by.name}'s review of ${ticket.goal}`,
    needs: existing?.needs ?? [],
    status: failed ? "failed" : "settled",
    result: findings,
    updatedAt: now,
  };
  return {
    ticket: { ...ticket, updatedAt: now, steps: [...ticket.steps.filter((s) => s.id !== id), step] },
    stepId: id,
  };
}

/** Is this step's work over — so anything waiting on it may go?
 *
 *  "Settled" for a task. On a REVIEW ticket a review step that failed is not
 *  unfinished work: `failed` is how "I read it and I want changes" is
 *  written, and that is the most complete a review gets. Treating it as
 *  incomplete left the author waiting forever for a reviewer who had already
 *  answered — which is the opposite of what a change request means. */
const answered = (ticket: Ticket, s: TicketStep): boolean =>
  s.status === "settled" || (ticket.kind === "review" && s.intent === "review" && s.status === "failed");

/** Steps that are up right now, whoever owns them: not settled, and
 *  everything they depend on has been answered.
 *
 *  One rule beyond the dependencies: on a review ticket that nobody was asked
 *  for, the author's own "address" step waits for a reader. Its `needs` are
 *  empty — there was nobody to name — so the dependency rule alone would
 *  make it actionable the instant the ticket is filed, and the author's agent
 *  would be told to act on feedback that does not exist. An open review sits
 *  open until somebody posts one (`postReview` writes a settled or failed
 *  review step); the person can still settle it by hand whenever they like.
 *
 *  Every reader of "is this up?" goes through here — the agent nudges and the
 *  lists both — because two implementations of one rule drift, and did. */
export function readySteps(ticket: Ticket): TicketStep[] {
  const done = new Set(ticket.steps.filter((s) => answered(ticket, s)).map((s) => s.id));
  const reviewed = ticket.steps.some((s) => s.intent === "review" && (s.status === "settled" || s.status === "failed"));
  return ticket.steps.filter(
    (s) =>
      (s.status === "pending" || s.status === "suspended") &&
      s.needs.every((n) => done.has(n)) &&
      !(ticket.kind === "review" && s.intent === "address" && s.needs.length === 0 && !reviewed),
  );
}

/** Steps a given peer should act on now: `readySteps`, theirs. */
export function actionableSteps(ticket: Ticket, pubkey: string): TicketStep[] {
  return readySteps(ticket).filter((s) => s.owner === pubkey);
}
