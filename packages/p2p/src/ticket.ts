import { Schema } from "effect";
import { conversationKey, Conversation, withActing, actingFields, type Acting } from "./acting";
import { deriveThreadId } from "./topic";
import { InvestigationOutcome, type InvestigationBrief, type InvestigationGoal } from "./review";

// The CallScript-inspired intermediate state for cross-peer work: a ticket is
// one inert, serializable record — the goal, every step, each step's owner and
// settlement — so any peer (and any TUI) can render, resume, or audit the task
// without replaying the conversation. Peers exchange DATA only: settling a
// step is a choice the owning peer's agent makes, never something a record
// can force.

/** "retired": the ticket's author withdrew the step before its owner did
 *  anything — a proposal's work replaced by other work, say. It stays on the
 *  ticket as history, never becomes actionable, and nothing waits on it. Only
 *  a pending or suspended step can be retired: what an owner has settled or
 *  failed is what happened. */
export const StepStatus = Schema.Literals(["pending", "suspended", "settled", "failed", "retired"]);
export type StepStatus = typeof StepStatus.Type;

/** Later states win a merge; ties resolve by updatedAt. */
export const STATUS_RANK: Record<StepStatus, number> = {
  pending: 0,
  suspended: 1,
  settled: 2,
  failed: 2,
  retired: 2,
};

/** What a take found for one of an investigation's goals, and what it filed
 *  from it (a follow-up the goal named). */
export const GoalAnswer = Schema.Struct({
  goal: Schema.String,
  outcome: InvestigationOutcome,
  findings: Schema.String,
  evidence: Schema.optional(Schema.Array(Schema.String)),
  spawned: Schema.optional(Schema.Array(Schema.String)),
});
export type GoalAnswer = typeof GoalAnswer.Type;

/** The goal an investigation with no goals of its own has: its question. */
export const QUESTION_GOAL = "q";

/** An investigation's goals: the ones it lists and has not withdrawn, or
 *  its question as the one. */
export const goalsOf = (brief: Pick<InvestigationBrief, "question" | "goals">): ReadonlyArray<InvestigationGoal> => {
  const open = (brief.goals ?? []).filter((goal) => !goal.withdrawn);
  return open.length > 0 ? open : [{ id: QUESTION_GOAL, ask: brief.question }];
};

export const TicketStep = Schema.Struct({
  id: Schema.String,
  /** Pubkey (hex) of the peer expected to settle this step. Absent on a
   *  task step filed with nobody asked: it sits in the room, delivered to no
   *  one, until somebody takes it (`takeStep`) or settles it. Once a step has
   *  an owner it keeps one. */
  owner: Schema.optional(Schema.String),
  /** Short verb, mirrors RoomMessage.intent (e.g. "review", "investigate"). */
  intent: Schema.String,
  /** What is being asked, in full. */
  description: Schema.String,
  /** Step ids that must settle before this one is actionable. */
  needs: Schema.Array(Schema.String),
  status: StepStatus,
  /** The owning agent's findings once settled (or the failure reason). */
  result: Schema.optional(Schema.String),
  /** A take that says something without a verdict: it answers the ticket,
   *  but approves nothing. Absent on every other step (and on older takes). */
  comment: Schema.optional(Schema.Boolean),
  /** On an investigation's take: what it found, goal by goal. A later take
   *  of the same person's keeps the goals it does not answer. */
  answers: Schema.optional(Schema.Array(GoalAnswer)),
  /** Which of the owner's agents wrote this state (Claude Code, Codex …) —
   *  attribution, never ownership: the step stays the person's. Absent when
   *  the person acted themselves, or nobody knows. Set by every write to the
   *  step, so it names who did what it says now. */
  agent: Schema.optional(Schema.String),
  /** Which of that agent's conversations wrote it, when the harness said;
   *  set and cleared with `agent` (acting withActing). */
  conversation: Schema.optional(Conversation),
  updatedAt: Schema.Finite,
});
export type TicketStep = typeof TicketStep.Type;

/** A step somebody has: asked of them, or taken. */
export type OwnedStep = TicketStep & { readonly owner: string };
export const isOwned = (step: TicketStep): step is OwnedStep => step.owner !== undefined;

/** What kind of work the ticket is. "task" is the plain one: a goal and its
 *  steps. Five ask for JUDGMENT and carry a why record (review.ts): an
 *  "investigation" — a question nobody can answer yet, closed with findings;
 *  a "proposal" — an idea written down, owed to no one, is it worth doing; a
 *  "plan" — how the author means to do something, do you agree; a "bug" — a
 *  symptom, with the reporter's reading of cause, importance and remedy, what
 *  do you make of it; a "review" of code that exists. Readers answer on steps
 *  of their own (`postReview`). An "epic" is neither: a folder of tickets
 *  that together make one body of work — no steps of its own, its state its
 *  parts' state, shaped by anyone in the room (see `PartMove`, `EpicTurn`). */
export const TicketKind = Schema.Literals(["task", "review", "plan", "proposal", "bug", "investigation", "epic"]);
export type TicketKind = typeof TicketKind.Type;

/** The kinds that ask for judgment and carry a why. */
export const isJudged = (kind: TicketKind): boolean => kind !== "task" && kind !== "epic";

/** A ticket put into an epic, or taken out of one (`epic: null`), or kept
 *  in it but out of its progress (`excluded`) — work dropped, or not to be
 *  done here. Anyone in the room may move any ticket: an epic is shared
 *  structure, like a room's name. Every move is kept — the ticket carries
 *  them all, merged as a set — and the latest is where it is now, so a
 *  ticket is in at most one epic. Membership is explicit: lineage (`from`)
 *  never puts a ticket anywhere. */
export const PartMove = Schema.Struct({
  /** Who and when, as one name: what a close records having seen. */
  id: Schema.String,
  epic: Schema.NullOr(Schema.String),
  excluded: Schema.optional(Schema.Boolean),
  /** Pubkey (hex) of who moved it. */
  by: Schema.String,
  at: Schema.Finite,
});
export type PartMove = typeof PartMove.Type;

/** An epic closed, or reopened — by anyone in the room, always with a
 *  reason on the record. Each turn says what its writer had seen when they
 *  made it: the turns before it (`knows`), and for a close the memberships
 *  into the epic it knew of (`members`, move ids). That, not the clock, decides the
 *  epic's state: a reopen, or a ticket put in, that a close had not seen
 *  keeps the epic open; a close made after seeing them stands (`epicClosed`). */
export const EpicTurn = Schema.Struct({
  id: Schema.String,
  closed: Schema.Boolean,
  reason: Schema.String,
  by: Schema.String,
  at: Schema.Finite,
  knows: Schema.Array(Schema.String),
  members: Schema.optional(Schema.Array(Schema.String)),
});
export type EpicTurn = typeof EpicTurn.Type;

/** The order an epic's tickets are read in (PHP before Rust) — for showing
 *  and discussing them, nothing else: it hides nothing and sets no `after`.
 *  Anyone's to set; the latest holds. */
export const EpicOrder = Schema.Struct({
  ids: Schema.Array(Schema.String),
  by: Schema.String,
  at: Schema.Finite,
});
export type EpicOrder = typeof EpicOrder.Type;

/** A reader's answer step: "review" on a review, "take" on a plan, a
 *  proposal or a bug. Same mechanics, different word — you review code, you
 *  take a position on a plan, you give your diagnosis of a bug. */
export const isTake = (step: { readonly intent: string }): boolean => step.intent === "review" || step.intent === "take";
export const takeIntent = (kind: TicketKind): string => (kind === "review" ? "review" : "take");

/** The author's decision that the ticket is over — recorded, not inferred.
 *  Every step answered means it MAY be ready to close; the person may also
 *  close a ticket whose reviewer never answered, or abandon one whose work
 *  stalled. Steps keep whatever state they had: closing is history, not a
 *  tidy-up. Like merging a pull request without a review: the author's call. */
export const Closed = Schema.Struct({
  /** Pubkey (hex) of who closed it — the author. */
  by: Schema.String,
  ts: Schema.Finite,
  /** Why, when a close needs explaining (abandoned, superseded, done differently). */
  reason: Schema.optional(Schema.String),
  /** How it ended: its work done, or dropped. Absent on closes from before
   *  it was asked — read as done (closedAs). */
  outcome: Schema.optional(Schema.Literals(["done", "dropped"])),
});
export type Closed = typeof Closed.Type;

/** How a closed ticket ended, or null while it is open. A close that did
 *  not say was made when dropped work was to be taken out of its epic or
 *  excluded, so one still counted there was done. */
export const closedAs = (ticket: Ticket): "done" | "dropped" | null => (ticket.closed ? (ticket.closed.outcome ?? "done") : null);

export const Ticket = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  /** The headline: a few words, what it is for — what the lists show. The
   *  author's structure, like the goal. Absent only on an old ticket's. */
  title: Schema.optional(Schema.String),
  /** The line beneath the title: what the ticket is about, in full. */
  goal: Schema.String,
  /** Pubkey (hex) of the creator — authoritative for the ticket's structure. */
  createdBy: Schema.String,
  /** When it was filed — never moved by a revision (structureAt is). Absent
   *  on a ticket filed before it was recorded. */
  filedAt: Schema.optional(Schema.Finite),
  kind: TicketKind,
  steps: Schema.Array(TicketStep),
  /** When the AUTHOR last changed the ticket's structure — goal, kind, from, after,
   *  whenClosed. Its own clock, apart from `updatedAt`: a peer posting a take
   *  or settling a step also advances updatedAt while broadcasting their
   *  whole (possibly stale) copy, and the author's latest decision must not
   *  lose to that. Steps merge per step; structure merges by this. */
  structureAt: Schema.Finite,
  /** Present once the author closed it: off the lists, on the log. */
  closed: Schema.optional(Closed),
  /** The tickets this one follows — a plan born of a proposal, a review of
   *  the work a plan agreed. A child names its parents; a parent never lists
   *  its children (derived, like everything else). */
  from: Schema.optional(Schema.Array(Schema.String)),
  /** The tickets this one waits on — ordering, apart from lineage: a review
   *  stacked on another is read after it, a plan's phase two after phase one.
   *  While any of them is unanswered (neither finished nor closed) the
   *  ticket is GATED: its author sees it, waiting; nobody else is shown it,
   *  nudged about it, or able to post on it. Author's structure, like
   *  `from`, set explicitly — never inferred — and checked when set: no
   *  unknown ids, no self, no cycle (`afterProblem`), so a ticket cannot be
   *  left invisible forever. `[]` withdraws it. */
  after: Schema.optional(Schema.Array(Schema.String)),
  /** Which epic this ticket is in, as every move ever made — the latest
   *  holds (`epicOf`). Anyone's to change, so not the author's structure. */
  partOf: Schema.optional(Schema.Array(PartMove)),
  /** An epic's closes and reopens, each with what it had seen (`epicClosed`). */
  turns: Schema.optional(Schema.Array(EpicTurn)),
  /** The order an epic's tickets are read in, every one set — the latest holds. */
  order: Schema.optional(Schema.Array(EpicOrder)),
  /** The author's instruction for the moment the ticket is CLOSED — "open
   *  the Jira tickets for each step" — written when it was filed, handed to
   *  their agent in the close outcome, and acted on then: not on the last
   *  settle, because that is a reader's word, not the author's acceptance. */
  whenClosed: Schema.optional(Schema.String),
  /** Which of the author's agents wrote their latest revision — filed it, or
   *  last amended it. The author's structure, like the goal: it follows
   *  `structureAt`. Absent when the author did it themselves, or nobody knows. */
  agent: Schema.optional(Schema.String),
  /** Which of that agent's conversations wrote it, when the harness said:
   *  follows `structureAt` with `agent`. */
  conversation: Schema.optional(Conversation),
  updatedAt: Schema.Finite,
});
export type Ticket = typeof Ticket.Type;

/** Merge an incoming copy of a ticket into the local one.
 *
 *  Multi-writer rules, chosen so concurrent edits converge on every peer
 *  regardless of arrival order (join semilattice per field):
 *  - steps are unioned by id — the creator adds structure, owners never lose steps
 *  - per step, the copy with the higher status rank wins; equal ranks resolve
 *    by updatedAt, then one order over the whole step — so two takes of an
 *    open step that never saw each other end on the later one, everywhere
 *  - title, goal, kind, from, after, whenClosed, agent and conversation follow the copy with the newer
 *    `structureAt` — the author's own clock, which only the author advances,
 *    so a peer's take or settle (which advances updatedAt on a possibly stale
 *    copy) can never revert the author's latest decision
 *  - closed sticks: once either copy carries it, the merge does — a copy
 *    written before the close cannot reopen it; two closes keep the earlier
 */
export function mergeTicket(local: Ticket, incoming: Ticket): Ticket {
  if (local.id !== incoming.id) return local;
  const steps = new Map<string, TicketStep>();
  for (const step of local.steps) steps.set(step.id, step);
  for (const step of incoming.steps) {
    const mine = steps.get(step.id);
    steps.set(step.id, mine ? mergeStep(mine, step) : step);
  }
  // on an exact tie of the author's clock, a titled revision before an
  // untitled one (a copy without a title never takes it away), then the
  // tiebreak: one order over whole revisions, so the merge stays associative
  // — borrowing a title from the other copy would make a revision nobody wrote
  const author =
    incoming.structureAt !== local.structureAt
      ? incoming.structureAt > local.structureAt
        ? incoming
        : local
      : (local.title === undefined) !== (incoming.title === undefined)
        ? (local.title !== undefined ? local : incoming)
        : structureTiebreak(local, incoming);
  const closed =
    local.closed && incoming.closed ? (local.closed.ts <= incoming.closed.ts ? local.closed : incoming.closed) : (local.closed ?? incoming.closed);
  const { from: _lf, after: _la, whenClosed: _lw, partOf: _lp, turns: _lt, order: _lo, agent: _lag, conversation: _lco, ...rest } = local;
  const partOf = union(local.partOf, incoming.partOf, (partMove) => partMove.id);
  const turns = union(local.turns, incoming.turns, (turn) => turn.id);
  const order = union(local.order, incoming.order, (ordering) => `${ordering.at}|${ordering.by}|${ordering.ids.join(",")}`);
  const { title: _ltitle, filedAt: _lfiled, ...unchanged } = rest;
  // the author's title — and on an exact tie of their clock, whichever copy
  // has one: a copy without a title never takes it away
  const title = author.title ?? (incoming.structureAt === local.structureAt ? (local.title ?? incoming.title) : undefined);
  // when it was filed: the one both copies know, the earlier if they differ
  const filedAt = local.filedAt !== undefined && incoming.filedAt !== undefined ? Math.min(local.filedAt, incoming.filedAt) : (local.filedAt ?? incoming.filedAt);
  return {
    ...unchanged,
    ...(title !== undefined ? { title } : {}),
    ...(filedAt !== undefined ? { filedAt } : {}),
    ...(partOf ? { partOf } : {}),
    ...(turns ? { turns } : {}),
    ...(order ? { order } : {}),
    goal: author.goal,
    kind: author.kind,
    // present wins, including an EMPTY value: `from: []` and `whenClosed: ""`
    // are how the author withdraws them, and a merge must carry that through
    ...(author.from !== undefined ? { from: author.from } : {}),
    ...(author.after !== undefined ? { after: author.after } : {}),
    ...(author.whenClosed !== undefined ? { whenClosed: author.whenClosed } : {}),
    ...(author.agent !== undefined ? { agent: author.agent } : {}),
    ...(author.conversation !== undefined ? { conversation: author.conversation } : {}),
    structureAt: author.structureAt,
    steps: [...steps.values()],
    ...(closed ? { closed } : {}),
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
  };
}

/** Two grow-only sets of acts, as one, in the order they happened (ties by
 *  key, so every peer lists them alike). Absent on both sides stays absent. */
function union<A extends { readonly at: number }>(ours: ReadonlyArray<A> | undefined, theirs: ReadonlyArray<A> | undefined, key: (x: A) => string): Array<A> | undefined {
  if (ours === undefined && theirs === undefined) return undefined;
  const all = new Map<string, A>();
  for (const act of [...(ours ?? []), ...(theirs ?? [])]) all.set(key(act), act);
  return [...all.entries()].sort(([firstKey, firstAct], [secondKey, secondAct]) => firstAct.at - secondAct.at || (firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0)).map(([, act]) => act);
}

/** The latest of a set of acts (the order `union` keeps). */
const latest = <A>(acts: ReadonlyArray<A> | undefined): A | undefined => (acts && acts.length > 0 ? acts[acts.length - 1] : undefined);

/** What a ticket is called where there is room for one line: its title,
 *  or — on an old ticket filed before titles — its goal. */
export const ticketName = (ticket: Pick<Ticket, "title" | "goal">): string => ticket.title ?? ticket.goal;

/** A move's or a turn's own name: unique, whoever writes it and however
 *  fast — two by the same person in one millisecond are two. */
const opId = (): string => globalThis.crypto.randomUUID();

/** Where a ticket is now: its latest move, if it was ever moved. */
const membership = (ticket: Ticket): PartMove | undefined => latest(ticket.partOf);

/** The epic a ticket is in now, or null. Only ever where it was put. */
export const epicOf = (ticket: Ticket): string | null => membership(ticket)?.epic ?? null;

/** Kept in its epic but out of its progress — dropped, or not to be done there. */
export const excludedFromEpic = (ticket: Ticket): boolean => membership(ticket)?.excluded === true;

/** Put a ticket into an epic, or take it out (null), or keep it in but out
 *  of progress (`excluded`). Anyone's to do. */
export function moveToEpic(ticket: Ticket, epic: string | null, by: string, now: number, excluded = false, id: string = opId()): Ticket {
  const move: PartMove = { id, epic, ...(epic && excluded ? { excluded: true } : {}), by, at: now };
  return { ...ticket, partOf: [...(ticket.partOf ?? []), move], updatedAt: now };
}

/** The epic a ticket being filed goes into: the one its filer named
 *  (`chosen`: an epic's id, or null for none), else the one open epic the
 *  tickets it grows out of are in — what grows out of a part of an epic is
 *  part of it too. None when they are in several epics, or in none. Filing
 *  puts it there with a move of its own; the lineage itself moves nothing. */
export function epicForFiling(from: ReadonlyArray<string>, all: ReadonlyMap<string, Ticket>, chosen?: string | null): string | null {
  if (chosen !== undefined) return chosen;
  const epics = new Set(
    from.flatMap((id) => {
      const parent = all.get(id);
      const epicId = parent ? epicOf(parent) : null;
      const epic = epicId ? all.get(epicId) : undefined;
      return epic && epic.kind === "epic" && !isClosed(epic, all) ? [epic.id] : [];
    }),
  );
  return epics.size === 1 ? [...epics][0]! : null;
}

/** An epic's tickets as lines of work: those joined by what grew out of what
 *  (through any ticket of the room) are one line — a proposal, its plan, the
 *  task and the review are stages of one piece of work; separate pieces are
 *  separate lines. Each line in the epic's reading order, placed where its
 *  first ticket is. */
export function epicLines(parts: ReadonlyArray<Ticket>, all: ReadonlyMap<string, Ticket>): ReadonlyArray<ReadonlyArray<Ticket>> {
  const leader = new Map<string, string>();
  const rootOf = (id: string): string => {
    const up = leader.get(id);
    if (up === undefined || up === id) return id;
    const root = rootOf(up);
    leader.set(id, root);
    return root;
  };
  for (const ticket of all.values()) for (const parent of ticket.from ?? []) leader.set(rootOf(ticket.id), rootOf(parent));
  const lines = new Map<string, Array<Ticket>>();
  for (const part of parts) {
    const root = rootOf(part.id);
    lines.set(root, [...(lines.get(root) ?? []), part]);
  }
  return [...lines.values()];
}

/** Done, as its epic counts it: every step answered, or closed as done. */
export const doneInEpic = (ticket: Ticket): boolean => finished(ticket) || closedAs(ticket) === "done";

/** Out of its epic's progress: excluded, or closed as dropped (4 of 5 becomes 4 of 4). */
export const outOfProgress = (ticket: Ticket): boolean => excludedFromEpic(ticket) || closedAs(ticket) === "dropped";

/** Is a ticket in an epic resolved — so the epic may close? Done (every step
 *  answered), closed, or excluded from progress. */
const resolved = (ticket: Ticket): boolean => finished(ticket) || (ticket.kind !== "epic" && ticket.closed !== undefined) || excludedFromEpic(ticket);

/** The tickets in an epic now, in its reading order (the latest one set,
 *  then the rest), and its progress in lines of work (epicLines): a line is
 *  done when every ticket of it is — every step answered, or closed as done —
 *  and counted unless all of it is excluded or closed as dropped, so 4 of 5
 *  becomes 4 of 4. */
export function epicParts(epic: Ticket, all: ReadonlyMap<string, Ticket>): {
  readonly parts: ReadonlyArray<Ticket>;
  /** the parts as lines of work (epicLines) — what progress counts */
  readonly lines: ReadonlyArray<ReadonlyArray<Ticket>>;
  readonly counted: number;
  readonly done: number;
  readonly unresolved: ReadonlyArray<Ticket>;
} {
  const inside = [...all.values()].filter((ticket) => ticket.kind !== "epic" && epicOf(ticket) === epic.id);
  const order = latest(epic.order)?.ids ?? [];
  const rank = (ticket: Ticket) => {
    const position = order.indexOf(ticket.id);
    return position === -1 ? order.length : position;
  };
  const parts = [...inside].sort((a, b) => rank(a) - rank(b));
  // progress counts lines of work, not tickets: filing the next stage of a
  // piece of work adds no more to get through
  const lines = epicLines(parts, all);
  const counted = lines.map((line) => line.filter((ticket) => !outOfProgress(ticket))).filter((line) => line.length > 0);
  return { parts, lines, counted: counted.length, done: counted.filter((line) => line.every(doneInEpic)).length, unresolved: parts.filter((ticket) => !resolved(ticket)) };
}

/** The turns no other turn has seen: what the room's latest word on the
 *  epic is, everyone's, however their clocks ran. */
const heads = (turns: ReadonlyArray<EpicTurn>): ReadonlyArray<EpicTurn> => {
  const seen = new Set(turns.flatMap((turn) => turn.knows));
  return turns.filter((turn) => !seen.has(turn.id));
};

/** Where an epic stands, and what decided it — the cause is always the one
 *  behind the state, never just the latest turn by clock:
 *  - a latest turn that is a reopen: open, for its reason;
 *  - every latest turn a close, but a ticket put in that one of them had
 *    not seen: open, because of that ticket — close it again once it is
 *    resolved or moved out;
 *  - a ticket in it not resolved: open, because of it;
 *  - otherwise closed, for the close's reason.
 *  An old reopen a close has seen never reopens it again. The state is the
 *  room's, decided on every ticket; how the cause is SAID depends on who
 *  reads it (`epicBecause`): a ticket they may not be shown is not named. */
export type EpicCause =
  | { readonly kind: "reopen"; readonly reason: string; readonly by: string; readonly at: number }
  | { readonly kind: "close"; readonly reason: string; readonly by: string; readonly at: number }
  | { readonly kind: "unseen-add"; readonly ticket: string; readonly by: string; readonly at: number }
  | { readonly kind: "unresolved"; readonly ticket: string };

export interface EpicStatus {
  readonly closed: boolean;
  readonly cause?: EpicCause;
}

const newest = <A extends { readonly at: number; readonly id: string }>(acts: ReadonlyArray<A>): A | undefined =>
  [...acts].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(-1);

export function epicStatus(epic: Ticket, all: ReadonlyMap<string, Ticket>): EpicStatus {
  const top = heads(epic.turns ?? []);
  if (top.length === 0) return { closed: false };
  const reopen = newest(top.filter((turn) => !turn.closed));
  if (reopen) return { closed: false, cause: { kind: "reopen", reason: reopen.reason, by: reopen.by, at: reopen.at } };
  // every latest word is a close: did each see everything put in?
  for (const ticket of all.values()) {
    for (const partMove of ticket.partOf ?? []) {
      if (partMove.epic === epic.id && top.some((turn) => !(turn.members ?? []).includes(partMove.id))) {
        return { closed: false, cause: { kind: "unseen-add", ticket: ticket.id, by: partMove.by, at: partMove.at } };
      }
    }
  }
  const unresolved = epicParts(epic, all).unresolved[0];
  if (unresolved) return { closed: false, cause: { kind: "unresolved", ticket: unresolved.id } };
  const close = newest(top)!;
  return { closed: true, cause: { kind: "close", reason: close.reason, by: close.by, at: close.at } };
}

/** The cause of an epic's state, in words for one reader: a ticket they may
 *  be shown is named; one waiting unseen (its author's alone) is not —
 *  the explanation never reveals what the lists hide. */
export function epicBecause(status: EpicStatus, all: ReadonlyMap<string, Ticket>, me: string): string | undefined {
  const cause = status.cause;
  if (!cause) return undefined;
  if (cause.kind === "reopen" || cause.kind === "close") return cause.reason;
  const ticket = all.get(cause.ticket);
  const named = ticket && visibleTo(ticket, all, me) ? `"${ticket.goal}"` : "a ticket you are not shown yet";
  return cause.kind === "unseen-add" ? `${named} was put in without the close seeing it — close it again once that is resolved or moved out` : `${named} in it is not resolved`;
}

/** Is the epic closed? `epicStatus`, its yes or no. */
export const epicClosed = (epic: Ticket, all: ReadonlyMap<string, Ticket>): boolean => epicStatus(epic, all).closed;

/** Every move ever made into an epic, by id — what a close records as seen. */
const movesInto = (epic: Ticket, all: ReadonlyMap<string, Ticket>): ReadonlyArray<string> =>
  [...all.values()].flatMap((ticket) => (ticket.partOf ?? []).filter((partMove) => partMove.epic === epic.id).map((partMove) => partMove.id));

/** Is the ticket closed? An epic by its turns and what is in it (pass the
 *  room's tickets; without them, by its turns alone), everything else by its
 *  author's close. Every "is it over" goes through here. */
export const isClosed = (ticket: Ticket, all?: ReadonlyMap<string, Ticket>): boolean => {
  if (ticket.kind !== "epic") return ticket.closed !== undefined;
  if (all) return epicClosed(ticket, all);
  const top = heads(ticket.turns ?? []);
  return top.length > 0 && top.every((turn) => turn.closed);
};

/** Set the order an epic's tickets are read in. Anyone's to do. */
export function orderEpic(epic: Ticket, ids: ReadonlyArray<string>, by: string, now: number): Ticket {
  return { ...epic, order: [...(epic.order ?? []), { ids: [...ids], by, at: now }], updatedAt: now };
}

export type TurnOutcome =
  /** it turned */
  | "turned"
  /** it was in that state already */
  | "already"
  /** reopening needs a reason, always */
  | "needs-reason"
  /** closing waits on these: resolve them, exclude them, or move them out */
  | "unresolved"
  /** not an epic: other tickets close with closeTicket, by their author */
  | "not-an-epic";

/** The reason an epic closes with when nobody gives one. */
export const PARTS_DONE = "its parts are done";

/** Close or reopen an epic, by anyone in the room, with the reason on the
 *  record and what the writer had seen. Closing waits until every ticket in
 *  it is resolved (the reason is then that they are, unless one is given);
 *  reopening always needs a reason. */
export function turnEpic(
  epic: Ticket,
  closed: boolean,
  reason: string | undefined,
  by: string,
  all: ReadonlyMap<string, Ticket>,
  now: number,
): { readonly ticket: Ticket; readonly outcome: TurnOutcome; readonly unresolved: ReadonlyArray<Ticket> } {
  if (epic.kind !== "epic") return { ticket: epic, outcome: "not-an-epic", unresolved: [] };
  // closing what is closed, or reopening what already has a reopen as its
  // latest word, is nothing; reopening an epic kept open only by a conflict
  // (a close that missed an addition) is a reopen worth recording
  const reopened = heads(epic.turns ?? []).some((epicTurn) => !epicTurn.closed) || (epic.turns ?? []).length === 0;
  if (closed ? epicClosed(epic, all) : reopened) return { ticket: epic, outcome: "already", unresolved: [] };
  const { unresolved } = epicParts(epic, all);
  if (closed && unresolved.length > 0) return { ticket: epic, outcome: "unresolved", unresolved };
  const why = reason?.trim() || (closed ? PARTS_DONE : undefined);
  if (!why) return { ticket: epic, outcome: "needs-reason", unresolved: [] };
  const turn: EpicTurn = {
    id: opId(),
    closed,
    reason: why,
    by,
    at: now,
    knows: (epic.turns ?? []).map((epicTurn) => epicTurn.id),
    ...(closed ? { members: [...movesInto(epic, all)] } : {}),
  };
  return { ticket: { ...epic, turns: [...(epic.turns ?? []), turn], updatedAt: now }, outcome: "turned", unresolved: [] };
}

/** The author-controlled structure, as one comparable string. */
const structureKey = (ticket: Ticket): string => JSON.stringify([ticket.goal, ticket.kind, ticket.from ?? null, ticket.whenClosed ?? null, ticket.after ?? null, ticket.title ?? null, ticket.agent ?? null, conversationKey(ticket.conversation)]);

/** Two author revisions in the same millisecond: pick one the same way on
 *  every peer, whichever side it arrived from, so the merge still commutes. */
const structureTiebreak = (first: Ticket, second: Ticket): Ticket => (structureKey(first) >= structureKey(second) ? first : second);

/** Would merging `mine` into `row` change the row? Steps are compared by id
 *  and content, structure and close by value — a ticket as data, order aside.
 *  This is what lets every peer restore its OWN contribution to a ticket after
 *  an eviction without any of them deleting another's: a copy that adds
 *  nothing is left alone, one that adds a step or a state is re-appended. */
export const contributes = (row: Ticket, mine: Ticket): boolean => canonical(mergeTicket(row, mine)) !== canonical(row);

const canonical = (ticket: Ticket): string =>
  JSON.stringify({
    ...ticket,
    steps: [...ticket.steps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });

export type CloseOutcome =
  /** closed, by its author */
  | "closed"
  /** somebody else's ticket: refused, nothing changed */
  | "not-yours"
  /** it was closed already */
  | "already"
  /** an epic: closed (and reopened) by anyone, with a reason — turnEpic */
  | "epic";

/** Close a ticket, as one rule for every caller: the author's decision, the
 *  steps untouched. Returns the closed ticket, or why not. */
export function closeTicket(ticket: Ticket, by: string, reason: string | undefined, now: number, ended?: "done" | "dropped"): { readonly ticket: Ticket; readonly outcome: CloseOutcome } {
  if (ticket.kind === "epic") return { ticket, outcome: "epic" };
  if (ticket.createdBy !== by) return { ticket, outcome: "not-yours" };
  if (ticket.closed) return { ticket, outcome: "already" };
  return {
    ticket: { ...ticket, closed: { by, ts: now, ...(reason ? { reason } : {}), ...(ended ? { outcome: ended } : {}) }, updatedAt: now },
    outcome: "closed",
  };
}

function mergeStep(first: TicketStep, second: TicketStep): TicketStep {
  const firstRank = STATUS_RANK[first.status];
  const secondRank = STATUS_RANK[second.status];
  if (firstRank !== secondRank) return firstRank > secondRank ? first : second;
  if (first.updatedAt !== second.updatedAt) return first.updatedAt > second.updatedAt ? first : second;
  // deterministic final tiebreak so all peers converge on the same copy
  if ((first.result ?? "") !== (second.result ?? "")) return (first.result ?? "") > (second.result ?? "") ? first : second;
  if ((first.agent ?? "") !== (second.agent ?? "")) return (first.agent ?? "") > (second.agent ?? "") ? first : second;
  if (conversationKey(first.conversation) !== conversationKey(second.conversation)) return conversationKey(first.conversation) > conversationKey(second.conversation) ? first : second;
  // what is left (two takes in one millisecond, a settle and a fail): the whole step decides
  return stepKey(first) >= stepKey(second) ? first : second;
}

/** A whole step as one comparable string, its fields in one order. */
const stepKey = (step: TicketStep): string =>
  JSON.stringify([step.status, step.owner ?? null, step.comment ?? null, step.intent, step.description, step.needs, step.answers ?? null]);

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
    : (step.needs.map((id) => ticket.steps.find((ticketStep) => ticketStep.id === id)?.owner).find(named) ?? creator);
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

export type Settlement =
  /** the step was yours, or nobody's: settled (or failed) in place */
  | { readonly ticket: Ticket; readonly outcome: "settled" }
  /** `owner`'s step: refused, nothing changed (say it with a message, or
   *  post your own review — see `postReview`) */
  | { readonly ticket: Ticket; readonly outcome: "not-yours"; readonly owner: string };

/** Settling a step, as one rule for every caller (the app's Dispatch and the
 *  test drive alike — two implementations of this drifted apart once). A step
 *  belongs to the person who owns it: nobody else settles it, on any kind of
 *  ticket. A step nobody has is anyone's: settling it takes it. Returns null
 *  when there is no such step. */
export function settleStep(
  ticket: Ticket,
  stepId: string,
  by: string,
  result: string,
  failed: boolean,
  now: number,
  acting?: Acting,
): Settlement | null {
  const step = ticket.steps.find((ticketStep) => ticketStep.id === stepId);
  if (!step) return null;
  if (step.owner !== undefined && step.owner !== by) return { ticket, outcome: "not-yours", owner: step.owner };
  const status = failed ? ("failed" as const) : ("settled" as const);
  return {
    ticket: {
      ...ticket,
      updatedAt: now,
      steps: ticket.steps.map((ticketStep) => (ticketStep.id === stepId ? withActing({ ...ticketStep, owner: by, status, result, updatedAt: now }, acting) : ticketStep)),
    },
    outcome: "settled",
  };
}

export type Take =
  /** it was nobody's: it is theirs now */
  | { readonly ticket: Ticket; readonly outcome: "taken" }
  /** it was theirs already */
  | { readonly ticket: Ticket; readonly outcome: "already" }
  /** `owner` has it */
  | { readonly ticket: Ticket; readonly outcome: "not-open"; readonly owner: string }
  /** withdrawn, or the ticket is closed: nothing to take */
  | { readonly ticket: Ticket; readonly outcome: "over" };

/** Taking a step nobody has, by anyone in the room — the one rule for the
 *  person's key in the TUI and their agent's tool alike. The step is theirs
 *  from then on, delivered to them like any step asked of them; one that is
 *  up already is marked delivered at once (`suspended`), since whoever took
 *  it knows it: nobody is woken by their own act. Two takes that never saw
 *  each other merge to one owner on every peer (`mergeStep`). Returns null
 *  when there is no such step. */
export function takeStep(ticket: Ticket, stepId: string, by: string, now: number, acting?: Acting): Take | null {
  const step = ticket.steps.find((ticketStep) => ticketStep.id === stepId);
  if (!step) return null;
  if (step.owner === by) return { ticket, outcome: "already" };
  if (step.owner !== undefined) return { ticket, outcome: "not-open", owner: step.owner };
  if (ticket.closed || step.status !== "pending") return { ticket, outcome: "over" };
  const up = readySteps(ticket).some((ready) => ready.id === stepId);
  return {
    ticket: {
      ...ticket,
      updatedAt: now,
      steps: ticket.steps.map((ticketStep) => (ticketStep.id === stepId ? withActing({ ...ticketStep, owner: by, status: up ? ("suspended" as const) : ("pending" as const), updatedAt: now }, acting) : ticketStep)),
    },
    outcome: "taken",
  };
}

/** A review, posted by whoever read the change — the peer who was asked, or
 *  one who was not. It lands on a step of their own (`review-<them>`), so a
 *  second and a third reader can review the same change without taking
 *  anything from each other, and posting again revises your own. This is why
 *  a review ticket needs no placeholder step for "somebody, eventually": a
 *  step exists when a person has something on it. `comment`: words with no
 *  verdict — answered, approving nothing. */
export function postReview(
  ticket: Ticket,
  by: { readonly key: string; readonly name: string },
  findings: string,
  failed: boolean,
  now: number,
  acting?: Acting,
  comment = false,
  answers: ReadonlyArray<GoalAnswer> = [],
): { readonly ticket: Ticket; readonly stepId: string } {
  const id = reviewStepId(by.name, by.key, new Map(ticket.steps.filter(isOwned).map((ticketStep) => [ticketStep.id, ticketStep.owner])));
  const existing = ticket.steps.find((ticketStep) => ticketStep.id === id);
  // goals this take does not answer keep what the last one said
  const given = new Set(answers.map((answer) => answer.goal));
  const kept = [...(existing?.answers ?? []).filter((answer) => !given.has(answer.goal)), ...answers];
  const step: TicketStep = {
    id,
    owner: by.key,
    intent: existing?.intent ?? takeIntent(ticket.kind),
    description: existing?.description ?? `${by.name}'s review of ${ticket.goal}`,
    needs: existing?.needs ?? [],
    status: failed ? "failed" : "settled",
    result: findings,
    ...actingFields(acting),
    ...(comment && !failed ? { comment: true } : {}),
    ...(kept.length > 0 ? { answers: kept } : {}),
    updatedAt: now,
  };
  return {
    ticket: { ...ticket, updatedAt: now, steps: [...ticket.steps.filter((ticketStep) => ticketStep.id !== id), step] },
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
const answered = (ticket: Ticket, step: TicketStep): boolean =>
  step.status === "settled" || step.status === "retired" || (ticket.kind === "review" && isTake(step) && step.status === "failed");
// …and only on a REVIEW. On a plan or a proposal a reader's ↻ means "revise
// this", so the ticket is not answered until they come back with a ✓ — and a
// proposal's work steps, which wait on that ✓, do not start.

/** Is every step answered — and is there at least one, since a ticket nobody
 *  has done anything on is not finished? This is the SIGNAL that the ticket
 *  may be ready to close, not the close: the author's agent is told "when your
 *  user is done with it, close it", and the person decides. Completion and
 *  closure are two different facts, and a ticket can be closed unfinished
 *  (a reviewer who never answered, work abandoned) or finished and still
 *  open (the author has not said so yet). */
export const finished = (ticket: Ticket): boolean => ticket.steps.length > 0 && ticket.steps.every((step) => answered(ticket, step));

export type RetireOutcome =
  | { readonly ticket: Ticket; readonly retired: ReadonlyArray<string>; readonly kept: ReadonlyArray<string>; readonly outcome: "retired" }
  | { readonly ticket: Ticket; readonly outcome: "not-yours" };

/** The author withdraws steps before their owners acted on them. Explicit —
 *  a list of ids, never removal by omission, so an incomplete amendment
 *  cannot erase work by accident. A step already settled or failed is kept
 *  as it is and named in `kept`; the retired ones stay on the ticket. */
export function retireSteps(ticket: Ticket, ids: ReadonlyArray<string>, by: string, now: number): RetireOutcome {
  if (ticket.createdBy !== by) return { ticket, outcome: "not-yours" };
  const want = new Set(ids);
  const retired: Array<string> = [];
  const kept: Array<string> = [];
  const steps = ticket.steps.map((step) => {
    if (!want.has(step.id)) return step;
    if (step.status === "pending" || step.status === "suspended") {
      retired.push(step.id);
      return { ...step, status: "retired" as const, updatedAt: now };
    }
    kept.push(step.id);
    return step;
  });
  return { ticket: retired.length > 0 ? { ...ticket, steps, updatedAt: now } : ticket, retired, kept, outcome: "retired" };
}

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
  const done = new Set(ticket.steps.filter((step) => answered(ticket, step)).map((step) => step.id));
  const reviewed = ticket.steps.some((step) => isTake(step) && (step.status === "settled" || step.status === "failed"));
  return ticket.steps.filter(
    (step) =>
      (step.status === "pending" || step.status === "suspended") &&
      step.needs.every((need) => done.has(need)) &&
      !(isJudged(ticket.kind) && step.intent === "address" && step.needs.length === 0 && !reviewed),
  );
}

/** Steps a given peer should act on now: `readySteps`, theirs. A step
 *  nobody has taken is nobody's to act on: it is delivered to no one. */
export function actionableSteps(ticket: Ticket, pubkey: string): OwnedStep[] {
  return readySteps(ticket).filter(isOwned).filter((step) => step.owner === pubkey);
}

/** Is this ticket's turn over for `me`, who waits on it? Finished (every
 *  step answered — on a review that includes the author's own address step),
 *  or closed: a ticket its author closed unfinished must not hold the next
 *  one back forever. And, for one reader, a review they approved: their part
 *  in it is done, so the next review in a stack opens to them then, in
 *  order, without waiting on the author. Asking for changes, or a comment,
 *  opens nothing. */
const released = (ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): boolean =>
  isClosed(ticket, all) || finished(ticket) || (isJudged(ticket.kind) && approvedBy(ticket, me));

/** `me` approved this ticket: a take of theirs settled, not a comment. */
const approvedBy = (ticket: Ticket, me: string): boolean =>
  ticket.steps.some((step) => isTake(step) && step.owner === me && step.status === "settled" && step.comment !== true);

/** The tickets in `after` still holding this one back for `me`. A
 *  predecessor this peer does not hold is no gate: `afterProblem` refused
 *  unknown ids when the order was set, so a missing one was evicted, and
 *  waiting on it would hide the ticket for good. */
export function heldBy(ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): ReadonlyArray<string> {
  return (ticket.after ?? []).filter((id) => {
    const predecessor = all.get(id);
    return predecessor !== undefined && !released(predecessor, all, me);
  });
}

/** Waiting, for `me`, on a ticket that has not been answered yet. */
export const gated = (ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): boolean => heldBy(ticket, all, me).length > 0;

/** May `me` be shown this ticket? Its author always — they keep it current
 *  while it waits; anyone else once it is no longer gated for them. Every
 *  reader of "is it there" for a person goes through here: the lists, the
 *  agent's tools, the nudges. */
export const visibleTo = (ticket: Ticket, all: ReadonlyMap<string, Ticket>, me: string): boolean =>
  ticket.createdBy === me || !gated(ticket, all, me);

/** Why an `after` cannot stand, or null. The take on the ordering plan named
 *  the three ways a ticket could otherwise become invisible for good: an id
 *  nobody holds, waiting on itself, and a cycle (directly or through others).
 *  `id` is the ticket being ordered (a new one has none on the log yet);
 *  `all` is what `me` can see — someone else's gated ticket is not a ticket
 *  you can name, or naming it would reveal it. */
export function afterProblem(
  id: string | undefined,
  after: ReadonlyArray<string>,
  all: ReadonlyMap<string, Ticket>,
  me: string,
): string | null {
  for (const afterId of after) {
    if (afterId === id) return "a ticket cannot wait on itself";
    const ticket = all.get(afterId);
    if (!ticket || !visibleTo(ticket, all, me)) return `no ticket ${afterId} — 'after' takes ids from get-tickets`;
  }
  if (id === undefined) return null;
  // would any ticket we wait on, followed through its own `after`, lead back here?
  const seen = new Set<string>();
  const stack = [...after];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === id) return "that order goes round in a circle: a ticket it waits on already waits on it";
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(all.get(next)?.after ?? []));
  }
  return null;
}
