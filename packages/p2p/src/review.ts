import { Schema } from "effect";

// The why behind a change, as data. A code review normally shows only the
// output — the what — and the reviewer has to guess the reasons. A review
// ticket carries them: what was decided, how the person steered it, what the
// agent reasoned, and every fork where the work could have gone another way.
// It rides the room's log beside the ticket, so it is there whether or not
// its author is online, and it is READ ON DEMAND — the reviewer's agent pulls
// it when their person asks, never on its own.

/** One decision behind the change. `userWhy` is the half a diff can never
 *  show: what the person asked for, prefaced or ruled out, in their words
 *  where possible. `agentWhy` is the agent's own reason for the shape it
 *  took. `where` points at the code it produced (file, or file:line). */
export const ReviewDecision = Schema.Struct({
  /** Stable within the review ("d1", "d2" …) so a question can name it. */
  id: Schema.String,
  what: Schema.String,
  userWhy: Schema.optional(Schema.String),
  agentWhy: Schema.optional(Schema.String),
  where: Schema.Array(Schema.String),
});
export type ReviewDecision = typeof ReviewDecision.Type;

/** A fork in the road: the work could have gone one way and went another.
 *  Not an essay — enough to judge whether the turn was right, plus a pointer
 *  to where the chosen road lives (file:line). */
export const ReviewFork = Schema.Struct({
  id: Schema.String,
  /** file:line of the code the choice produced. */
  at: Schema.String,
  chose: Schema.String,
  /** The road not taken. */
  instead: Schema.String,
  why: Schema.String,
  /** Who settled it — the person, or the agent on its own. */
  by: Schema.optional(Schema.Literals(["user", "agent"])),
});
export type ReviewFork = typeof ReviewFork.Type;

/** Everything the reviewer needs that a diff does not carry. One per ticket. */
export const ReviewContext = Schema.Struct({
  ticketId: Schema.String,
  /** Whose agent wrote this (key), and their name at the time. */
  author: Schema.String,
  authorName: Schema.String,
  /** The change in the author's own words — the what. */
  summary: Schema.String,
  /** Where the code is: the branch, what it is cut from, and a link (a pull
   *  request, a compare view — whatever the reviewer can open). */
  branch: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  link: Schema.optional(Schema.String),
  decisions: Schema.Array(ReviewDecision),
  forks: Schema.Array(ReviewFork),
  ts: Schema.Finite,
});
export type ReviewContext = typeof ReviewContext.Type;

/** An amendment: the fields the author is changing. Work continues while a
 *  review runs, so decisions and forks arrive in more than one go. */
export interface ReviewDelta {
  readonly summary?: string;
  readonly branch?: string;
  readonly base?: string;
  readonly link?: string;
  readonly decisions?: ReadonlyArray<{
    readonly id?: string;
    readonly what: string;
    readonly userWhy?: string;
    readonly agentWhy?: string;
    /** file, or file:line */
    readonly where?: ReadonlyArray<string>;
  }>;
  readonly forks?: ReadonlyArray<{
    readonly id?: string;
    readonly at: string;
    readonly chose: string;
    readonly instead: string;
    readonly why: string;
    readonly by?: "user" | "agent";
  }>;
}

const nextId = (prefix: string, taken: ReadonlyArray<string>): string => {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

/** Fold an amendment into what the log already has. Scalars are replaced when
 *  given; decisions and forks merge by id — a repeated id is a correction, a
 *  new (or missing) one appends with the next free number. The whole record
 *  then goes on the log, where the later `ts` wins: the author is the only
 *  writer of their own review, so there is nothing to reconcile. */
export const mergeReview = (base: ReviewContext, delta: ReviewDelta, ts: number): ReviewContext => {
  const decisions = [...base.decisions];
  for (const d of delta.decisions ?? []) {
    const id = d.id ?? nextId("d", decisions.map((x) => x.id));
    const at = decisions.findIndex((x) => x.id === id);
    const entry: ReviewDecision = { ...d, id, where: d.where ?? [] };
    if (at === -1) decisions.push(entry);
    else decisions[at] = entry;
  }
  const forks = [...base.forks];
  for (const f of delta.forks ?? []) {
    const id = f.id ?? nextId("f", forks.map((x) => x.id));
    const at = forks.findIndex((x) => x.id === id);
    const entry: ReviewFork = { ...f, id };
    if (at === -1) forks.push(entry);
    else forks[at] = entry;
  }
  return {
    ...base,
    summary: delta.summary ?? base.summary,
    ...(delta.branch ?? base.branch ? { branch: delta.branch ?? base.branch } : {}),
    ...(delta.base ?? base.base ? { base: delta.base ?? base.base } : {}),
    ...(delta.link ?? base.link ? { link: delta.link ?? base.link } : {}),
    decisions,
    forks,
    ts,
  };
};

/** An empty review to fold the first delta into. */
export const emptyReview = (ticketId: string, author: string, authorName: string): ReviewContext => ({
  ticketId,
  author,
  authorName,
  summary: "",
  decisions: [],
  forks: [],
  ts: 0,
});
