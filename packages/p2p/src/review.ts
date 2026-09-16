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

/** One item of a proposal's outline: what the work MIGHT involve and who
 *  MIGHT do it, as the author sees it. Non-binding — nobody owes anything
 *  until a plan names them. Kept by id so a revision can correct one line. */
export const OutlineItem = Schema.Struct({
  id: Schema.String,
  intent: Schema.String,
  description: Schema.String,
  /** A suggested owner, by name; a suggestion only. */
  owner: Schema.optional(Schema.String),
});
export type OutlineItem = typeof OutlineItem.Type;

/** How big the fix is, as the reporter guesses it — a coarse estimate of the
 *  REMEDY, kept apart from where the symptom lives (that is `cause.where`).
 *  line: a local fix. system: an existing system does the wrong thing, fix it
 *  where it is. refactor: right in intent, wrong in shape. new: the system
 *  that should handle this does not exist. A take may disagree. */
export const Remedy = Schema.Literals(["line", "system", "refactor", "new"]);
export type Remedy = typeof Remedy.Type;

/** Importance, anchored so two reporters mean the same by a 3:
 *  1 cosmetic — nobody is blocked; 2 annoying — a workaround exists;
 *  3 wrong — a feature fails for some; 4 blocking — a feature fails for all;
 *  5 breaking — data loss, a security hole, or nothing works. */
export const IMPORTANCE = {
  1: "cosmetic — nobody is blocked",
  2: "annoying — a workaround exists",
  3: "wrong — a feature fails for some",
  4: "blocking — a feature fails for everyone",
  5: "breaking — data loss, a security hole, or nothing works",
} as const;
export const ImportanceScore = Schema.Literals([1, 2, 3, 4, 5]);
export type ImportanceScore = typeof ImportanceScore.Type;

/** A bug as reported: the symptom is the one fact and the only required
 *  field; the rest is the reporter's reading, each an answer a fixer and,
 *  later, a reviewer will ask for. */
export const BugReport = Schema.Struct({
  /** What is wrong, as experienced. */
  symptom: Schema.String,
  /** What is actually happening, and where — project and file:line. */
  cause: Schema.optional(Schema.Struct({ what: Schema.String, where: Schema.Array(Schema.String) })),
  /** A score on the anchored scale, and the effect in words. Neither alone. */
  importance: Schema.optional(Schema.Struct({ score: ImportanceScore, effect: Schema.String })),
  /** How or what could fix it; `requirements` are loose — a bug is never
   *  filed with requirements, a plan lifts these into real ones. */
  suggestion: Schema.optional(Schema.Struct({ what: Schema.String, requirements: Schema.Array(Schema.String) })),
  remedy: Schema.optional(Remedy),
});
export type BugReport = typeof BugReport.Type;

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
  /** A proposal's idea of the work, when its author has one (see OutlineItem). */
  outline: Schema.optional(Schema.Array(OutlineItem)),
  /** A bug ticket's report (see BugReport). */
  bug: Schema.optional(BugReport),
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
  /** Outline items, merged by id like decisions. */
  readonly outline?: ReadonlyArray<OutlineItem>;
  /** Outline ids withdrawn — an outline is intent, not history, so they go. */
  readonly retireOutline?: ReadonlyArray<string>;
  /** A bug report, whole or in part: fields given replace, fields left out keep. */
  readonly bug?: Partial<BugReport>;
  /** Optional report fields withdrawn — a disproven cause, a score that no longer holds. */
  readonly retireBug?: ReadonlyArray<"cause" | "importance" | "suggestion" | "remedy">;
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
  let outline = base.outline === undefined && delta.outline === undefined ? undefined : [...(base.outline ?? [])];
  if (outline !== undefined) {
    for (const o of delta.outline ?? []) {
      const at = outline.findIndex((x) => x.id === o.id);
      if (at === -1) outline.push(o);
      else outline[at] = o;
    }
    if (delta.retireOutline && delta.retireOutline.length > 0) outline = outline.filter((x) => !delta.retireOutline!.includes(x.id));
  }
  // a bug report merges field by field: the symptom is corrected by giving
  // it again, a cause arrives when it is known, importance when it is judged
  // a bug report merges field by field: a field given replaces, a field left
  // out keeps, a field named in retireBug goes — a cause disproven or a score
  // that no longer holds must be withdrawable, not only overwritten
  const gone = new Set(delta.retireBug ?? []);
  const merged = delta.bug === undefined && gone.size === 0 ? undefined : { ...(base.bug ?? { symptom: "" }), ...(delta.bug ?? {}) };
  const bug: BugReport | undefined =
    merged === undefined
      ? base.bug
      : {
          symptom: merged.symptom ?? "",
          ...(merged.cause && !gone.has("cause") ? { cause: merged.cause } : {}),
          ...(merged.importance && !gone.has("importance") ? { importance: merged.importance } : {}),
          ...(merged.suggestion && !gone.has("suggestion") ? { suggestion: merged.suggestion } : {}),
          ...(merged.remedy && !gone.has("remedy") ? { remedy: merged.remedy } : {}),
        };
  return {
    ...base,
    summary: delta.summary ?? base.summary,
    ...(delta.branch ?? base.branch ? { branch: delta.branch ?? base.branch } : {}),
    ...(delta.base ?? base.base ? { base: delta.base ?? base.base } : {}),
    ...(delta.link ?? base.link ? { link: delta.link ?? base.link } : {}),
    decisions,
    forks,
    ...(outline !== undefined ? { outline } : {}),
    ...(bug !== undefined ? { bug } : {}),
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
