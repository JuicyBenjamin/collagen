import { closedAs, IMPORTANCE, isTake, type Assumed, type BugReport, type Confidence, type OutlineItem, type ReviewContext, type ReviewDecision, type ReviewFork, type Ticket } from "@collagen/p2p";
import type { YourReview } from "@collagen/review-web/data";
import { actedBy } from "./agents";

/** A review's why, as the agent hands it over and as a reader gets it back.
 *  The point of the whole thing: a diff shows the what, and the reviewer has
 *  to guess the why. Here the why is data — the person's steering and the
 *  agent's reasoning, plus every fork where the work could have gone another
 *  way, each pointing at the code it produced. */

/** A decision's title is a headline, not a sentence: longer is refused. */
export const TITLE_MAX = 60;

/** A review's summary heads its page: a sentence or two, no more. */
export const SUMMARY_MAX = 200;

/** A break, or any other control character: a headline is one line. */
const LINE_BREAK = /[\u0000-\u001f\u007f\u2028\u2029]/;

/** Why a ticket's title cannot stand, or null: it is the headline the
 *  lists show — a few words, what the ticket is for — and the goal is the
 *  line beneath it. */
export const ticketTitleGap = (title: string | undefined): string | null => {
  const trimmed = title?.trim() ?? "";
  if (LINE_BREAK.test(trimmed)) return `failed: the title runs over more than one line — a headline is one line (each break would take a row of the list); put the rest in the goal, beneath it`;
  if (trimmed.length === 0) return `failed: pass a 'title' — the ticket's headline, a few words (${TITLE_MAX} characters at most) saying what it is for; the lists show it, and the goal is the line beneath it`;
  if (trimmed.length > TITLE_MAX) return `failed: the title is ${trimmed.length} characters ("${trimmed.slice(0, 40)}…") — a title is a headline of a few words, ${TITLE_MAX} at most; the detail belongs in the goal, beneath it`;
  return null;
};

/** Why a unit's title cannot stand, or null: a unit is titled by what it
 *  achieves — "Big exports finish" — never by a file or a path, which says
 *  where the code is and not why it is there. The reader navigates by these. */
export const unitTitleGap = (title: string, what: string): string | null => {
  const gap = ticketTitleGap(title);
  if (gap) return gap.replace("the ticket's headline", `a unit's title`).replace("the lists show it, and the goal is the line beneath it", "the review page lists units by it");
  const trimmed = title.trim();
  // a path, or nothing but file names ("Mcp.ts", "export.ts · use.ts") —
  // "Node.js upgrade" and "v1.2 release notes" are purposes and pass
  const words = trimmed.split(/[\s,·&+]+|\band\b/).filter((word) => word.length > 0);
  if (/[\\/]/.test(trimmed) || (words.length > 0 && words.every((word) => /^[\w.-]*\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(word) && !/^\d/.test(word.split(".").pop()!))))
    return `failed: unit "${trimmed}" is titled by a file — title it by what it achieves ("Big exports finish", "Typos caught before merge"); the files go in its 'where'`;
  if (what.trim().length === 0) return `failed: unit "${trimmed}" has no 'what' — the line beneath its title: what that code does, in a line`;
  return null;
};

/** What an old ticket's decision, filed before titles, shows in its place. */
export const NO_TITLE = "old ticket — no title";

export interface DecisionInput {
  readonly id?: string;
  readonly title: string;
  readonly what: string;
  readonly userWhy?: string;
  readonly agentWhy?: string;
  readonly where?: ReadonlyArray<string>;
  readonly guidedBy?: ReadonlyArray<string>;
  /** an assumption's evidence, and how sure of it the AI is */
  readonly basis?: string;
  readonly confidence?: Confidence;
}
export interface ForkInput {
  readonly id?: string;
  readonly at: string;
  readonly chose: string;
  readonly instead: string;
  readonly why: string;
  readonly by?: "user" | "agent";
  readonly basis?: string;
  readonly confidence?: Confidence;
}
export interface ReviewInput {
  readonly summary?: string;
  readonly branch?: string;
  readonly base?: string;
  readonly link?: string;
  readonly decisions?: ReadonlyArray<DecisionInput>;
  readonly forks?: ReadonlyArray<ForkInput>;
  /** A proposal's outline, and the ids withdrawn from it — changes to the why too. */
  readonly outline?: ReadonlyArray<unknown>;
  readonly retireOutline?: ReadonlyArray<string>;
  /** A bug report, whole or in part, and the optional fields withdrawn. */
  readonly bug?: Partial<BugReport>;
  readonly retireBug?: ReadonlyArray<string>;
  /** A review's units, and the ids withdrawn — how its code reads. */
  readonly units?: ReadonlyArray<unknown>;
  readonly retireUnits?: ReadonlyArray<string>;
  /** Where the change runs, and the ids withdrawn. */
  readonly shows?: ReadonlyArray<unknown>;
  readonly retireShows?: ReadonlyArray<string>;
  /** the why is inferred, not told (see p2p Assumed) */
  readonly assumed?: Assumed;
  /** guesses withdrawn, by id */
  readonly retireGuesses?: ReadonlyArray<string>;
}

const blank = (text: string | undefined): boolean => (text ?? "").trim().length === 0;

/** What is missing before this is worth a reviewer's time, said as the thing
 *  to go and do. A review without the why is the status quo, so the tool
 *  refuses it rather than sending half of one. `amending` relaxes the
 *  wholesale checks: a later call adds to a review that already stands. */
export type JudgedKind = "review" | "plan" | "proposal" | "bug";

/** What is missing before this is worth a reader's time. A review without a
 *  summary and a why is the status quo, so it is refused. A plan's summary is
 *  its thinking in a paragraph; a proposal is the cheap kind — an idea is a
 *  goal and at least one thought, nothing more is demanded. */
export const reviewGaps = (input: ReviewInput, amending: boolean, kind: JudgedKind = "review"): string | null => {
  const decisions = input.decisions ?? [];
  const forks = input.forks ?? [];
  // a bug is its symptom: that is the one fact and the one thing demanded.
  // The rest of the report is the reporter's reading and arrives as it is known.
  if (kind === "bug") {
    const bug = input.bug ?? {};
    if (!amending && blank(bug.symptom)) return "failed: pass the symptom — what is wrong, as your user experienced it, in their words. It is the one thing a bug report always has.";
    if (bug.importance && blank(bug.importance.effect)) return `failed: importance needs the effect in words beside the score (${bug.importance.score} means "${IMPORTANCE[bug.importance.score]}") — a number alone is a guess`;
    if (bug.cause && blank(bug.cause.what)) return "failed: cause needs 'what' — what is actually happening; 'where' is the project and file:line it happens in";
    if (bug.suggestion && blank(bug.suggestion.what)) return "failed: suggestion needs 'what' — how or what could fix it; loose requirements go in 'requirements'";
    const moved = Object.keys(bug).length > 0 || (input.retireBug?.length ?? 0) > 0 || decisions.length > 0 || forks.length > 0 || !blank(input.summary);
    if (amending && !moved) return "failed: nothing to amend — pass the part of the report that changed, or a decision";
  }
  if (!amending && kind !== "proposal" && kind !== "bug" && blank(input.summary)) {
    return kind === "review"
      ? "failed: pass a summary — the purpose in a sentence or two: what is different for whoever uses it once it lands, not a commit list"
      : "failed: pass a summary — your user's thinking in a paragraph: what they intend and how, in their terms";
  }
  if (!amending && kind !== "bug" && decisions.length === 0) {
    return kind === "review"
      ? "failed: pass the decisions behind the change. Read back over THIS conversation and take them from it: what your user asked for, what they prefaced, what they ruled out, what you chose on your own and why. A review with no why is the review they already get from a diff."
      : `failed: pass at least one decision — a thought behind the ${kind}: 'what' your user means, 'userWhy' in their words, or 'agentWhy' as yours. ${kind === "proposal" ? "One is enough: an idea written down is still an idea with a reason." : "Read back over THIS conversation and take them from it."}`;
  }
  // a review's summary is the page's headline: the purpose, not the build
  if (kind === "review" && input.summary !== undefined && input.summary.trim().length > SUMMARY_MAX) {
    return `failed: the summary is ${input.summary.trim().length} characters — a review's summary is its headline, ${SUMMARY_MAX} at most: the purpose in a sentence or two, what is different for whoever uses it once it lands. How it was built belongs in the decisions; the code carries the rest.`;
  }
  const outlineMoves = (input.outline?.length ?? 0) > 0 || (input.retireOutline?.length ?? 0) > 0;
  const bugMoves = Object.keys(input.bug ?? {}).length > 0 || (input.retireBug?.length ?? 0) > 0;
  const unitsMove = (input.units?.length ?? 0) > 0 || (input.retireUnits?.length ?? 0) > 0 || (input.shows?.length ?? 0) > 0 || (input.retireShows?.length ?? 0) > 0;
  if (amending && decisions.length === 0 && forks.length === 0 && blank(input.summary) && blank(input.branch) && blank(input.base) && blank(input.link) && !outlineMoves && !bugMoves && !unitsMove && (input.retireGuesses?.length ?? 0) === 0) {
    return "failed: nothing to amend — pass the decisions, forks or fields you are adding";
  }
  for (const [index, decision] of decisions.entries()) {
    const at = decision.id ?? `decision ${index + 1}`;
    if (blank(decision.what)) return `failed: ${at} has no 'what' — say what was decided in one line`;
    if (blank(decision.title)) {
      return `failed: ${at} ("${decision.what.slice(0, 40)}") has no 'title'. Every decision needs one: its headline, a few words (${TITLE_MAX} characters at most) saying what it is for — the reader sees it before anything else, so it has to say the purpose at a glance. 'what' stays the one line beneath it.`;
    }
    if (LINE_BREAK.test(decision.title.trim())) return `failed: ${at}'s title runs over more than one line — a headline is one line; the rest belongs in 'what', beneath it`;
    if (decision.title.trim().length > TITLE_MAX) {
      return `failed: ${at}'s title is ${decision.title.trim().length} characters ("${decision.title.slice(0, 40)}…") — a title is a headline of a few words, ${TITLE_MAX} at most: what the decision is for, not how. The detail belongs in 'what', beneath it.`;
    }
    if (blank(decision.userWhy) && blank(decision.agentWhy)) {
      return `failed: ${at} ("${decision.what.slice(0, 40)}") has no why. 'userWhy' is how your user steered it — what they asked for or ruled out, in their words where you have them; 'agentWhy' is your own reason. One of them at least, or the reviewer is guessing again.`;
    }
    // a review's why sits beside the code it explains: one pointing nowhere is
    // read beside nothing (a revised one keeps its pointers when it names none)
    if (kind === "review" && (decision.where ?? []).every(blank) && (decision.where !== undefined || decision.id === undefined)) {
      return `failed: ${at} ("${decision.what.slice(0, 40)}") has no 'where'. Point at the code it shaped — a file, or file:line — every place, when it is a rule applied across the change (each hunk it decided). A decision to leave code alone points at that code: the page shows it as kept.`;
    }
  }
  for (const [index, fork] of forks.entries()) {
    const at = fork.id ?? `fork ${index + 1}`;
    if (blank(fork.at)) return `failed: ${at} has no 'at' — point at the code the choice produced (file:line)`;
    if (blank(fork.chose) || blank(fork.instead)) return `failed: ${at} needs both roads: 'chose' and 'instead'`;
    if (blank(fork.why)) return `failed: ${at} has no 'why' — enough for the reviewer to judge the turn, not an essay`;
  }
  return null;
};

/** One line: where the code is and how much why came with it. The link is
 *  left out where the line has to fit a terminal row — the page shows it. */
export const reviewHeadline = (review: ReviewContext, options?: { readonly link?: boolean }): string => {
  const where = review.branch ? (review.base ? `${review.branch} → ${review.base}` : review.branch) : "";
  return [where, (options?.link ?? true) ? (review.link ?? "") : "", `${review.decisions.length} decision${review.decisions.length === 1 ? "" : "s"}`, `${review.forks.length} fork${review.forks.length === 1 ? "" : "s"}`]
    .filter((part) => part.length > 0)
    .join(" · ");
};

const hay = (item: ReviewDecision | ReviewFork | OutlineItem): string =>
  Object.values(item)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

/** The whole why, or the part of it that is about something — a file, a
 *  symbol, a phrase the reader just used ("the retry loop"). Filtering keeps
 *  a big review answerable one question at a time. */
export const reviewRows = (review: ReviewContext, about?: string) => {
  const query = (about ?? "").trim().toLowerCase();
  const keep = <T extends ReviewDecision | ReviewFork | OutlineItem>(items: ReadonlyArray<T>): ReadonlyArray<T> =>
    query.length === 0 ? items : items.filter((item) => hay(item).includes(query));
  const decisions = keep(review.decisions);
  const forks = keep(review.forks);
  // a proposal's outline is searched like the rest: "bob" finds the item he
  // is suggested for, "mailer" the item about the mailer
  const outline = keep(review.outline ?? []);
  // the bug report is one block: it is in the answer when nothing is asked
  // about, or when the question touches any of its words
  const bug = review.bug && (query.length === 0 || hayBug(review.bug).includes(query)) ? review.bug : undefined;
  return {
    review: {
      by: actedBy(review.authorName, review.agent),
      ...(review.branch ? { branch: review.base ? `${review.branch} → ${review.base}` : review.branch } : {}),
      ...(review.link ? { link: review.link } : {}),
      summary: review.summary,
      // nobody told this why: it was inferred, and from what
      ...(review.assumed && !review.claimed ? { assumed: `${review.authorName}'s AI guessed every decision and fork here about ${review.assumed.author}'s code, from ${review.assumed.sources.join(", ")} — each with what it rests on and how sure it is` } : {}),
      ...(review.claimed ? { takenOver: `${review.claimed.guessedByName}'s AI guessed this; ${review.authorName}, who wrote the code, answered each guess (confirmed, corrected — with what was guessed — or wrong); one with no verdict is still a guess` } : {}),
      // reviews outlive the first read: this is the why as it stands NOW
      updated: new Date(review.ts).toISOString(),
      ...(query.length > 0
        ? {
            about: query,
            matched: `${decisions.length} of ${review.decisions.length} decisions, ${forks.length} of ${review.forks.length} forks${review.outline && review.outline.length > 0 ? `, ${outline.length} of ${review.outline.length} outline items` : ""}${review.bug ? `, the bug report ${bug ? "matched" : "did not match"}` : ""}`,
          }
        : {}),
    },
    decisions: decisions.map((decision) =>
      review.claimed
        ? { id: decision.id, title: decision.title ?? NO_TITLE, what: decision.what, verdict: decision.verdict ?? (decision.basis !== undefined ? "still a guess" : "told"), userWhy: decision.userWhy ?? "", agentWhy: decision.agentWhy ?? "", guessed: decision.guess ? `${decision.guess.what}${decision.guess.why ? ` — ${decision.guess.why}` : ""}` : "", where: decision.where.join(" ") }
        : review.assumed
        ? { id: decision.id, title: decision.title ?? NO_TITLE, what: decision.what, assumedWhy: decision.agentWhy ?? "", basis: decision.basis ?? "", confidence: decision.confidence ?? "", where: decision.where.join(" ") }
        : {
            id: decision.id,
            title: decision.title ?? NO_TITLE,
            what: decision.what,
            userWhy: decision.userWhy ?? "",
            agentWhy: decision.agentWhy ?? "",
            where: decision.where.join(" "),
            guidedBy: (decision.guidedBy ?? []).join(", "),
          },
    ),
    forks: forks.map((fork) => (review.claimed ? { id: fork.id, at: fork.at, chose: fork.chose, instead: fork.instead, why: fork.why, verdict: fork.verdict ?? (fork.basis !== undefined ? "still a guess" : "told"), guessed: fork.guess ? fork.guess.what : "" } : review.assumed ? { id: fork.id, at: fork.at, chose: fork.chose, instead: fork.instead, why: fork.why, basis: fork.basis ?? "", confidence: fork.confidence ?? "" } : { id: fork.id, at: fork.at, chose: fork.chose, instead: fork.instead, why: fork.why, by: fork.by ?? "" })),
    // how the change reads, as its author's agent grouped it
    ...(review.units && review.units.length > 0 ? { units: review.units.map((unit) => ({ id: unit.id, title: unit.title, ...(unit.what ? { what: unit.what } : {}), where: unit.where.join(" "), ...(review.units!.some((other) => other.usesOf) ? { usesOf: unit.usesOf ?? "" } : {}) })) } : {}),
    // where it can be seen running: a page to open
    ...(review.shows && review.shows.length > 0 ? { shows: review.shows.map((show) => ({ id: show.id, title: show.title, url: show.url })) } : {}),
    // a proposal's outline: what the work might be and who might do it — the
    // author's suggestion, binding on nobody; a plan lifts it into real steps
    ...(outline.length > 0 ? { outline: outline.map((item) => ({ id: item.id, intent: item.intent, description: item.description, owner: item.owner ?? "" })) } : {}),
    // a bug's report, whole: the symptom is the fact, the rest the reporter's reading
    ...(bug ? { bug: bugRows(bug) } : {}),
  };
};

/** Searched exactly as rendered — the score and its anchor included, so
 *  "4" and "blocking" find the report the reader would see them in. */
const hayBug = (bug: BugReport): string => Object.values(bugRows(bug)).join(" ").toLowerCase();

/** The report as a reader gets it: the score with its anchor spelled out, so
 *  "3" reads as "3 — wrong: a feature fails for some" and not as a number. */
export const bugRows = (bug: BugReport) => ({
  symptom: bug.symptom,
  ...(bug.cause ? { cause: bug.cause.what, where: bug.cause.where.join(" ") } : {}),
  ...(bug.importance ? { importance: `${bug.importance.score} — ${IMPORTANCE[bug.importance.score]}`, effect: bug.importance.effect } : {}),
  ...(bug.suggestion ? { suggestion: bug.suggestion.what, requirements: bug.suggestion.requirements.join("; ") } : {}),
  ...(bug.remedy ? { remedy: `${bug.remedy} — ${REMEDY_WORDS[bug.remedy]}` } : {}),
});

/** What each remedy means, in one clause — the reporter's coarse estimate of
 *  the fix; where the symptom lives is `cause.where`, a different question. */
export const REMEDY_WORDS = {
  line: "a local fix",
  system: "an existing system does the wrong thing; fix it where it is",
  refactor: "right in intent, wrong in shape",
  new: "the system that should handle this does not exist",
} as const;

/** What an assumed review is missing: the why it carries is a guess, so a
 *  reader must be able to weigh each one — what it was inferred from and how
 *  sure the AI is — and nothing in it may pass for the author's own words. */
export const assumedGaps = (input: ReviewInput, amending: boolean): string | null => {
  const assumed = input.assumed;
  if (!amending && (!assumed || blank(assumed.author))) return "failed: pass 'author' — who wrote the code (their login on the host, or their name); with a pull request link it is read from the host";
  if (!amending && (assumed?.sources ?? []).filter((source) => !blank(source)).length === 0) {
    return "failed: pass 'sources' — what you read to infer the why: the pull request's description, its commits, a linked ticket (\"JIRA-123\"), the code itself. A reader weighs a guess by what it rests on.";
  }
  for (const [index, decision] of (input.decisions ?? []).entries()) {
    const at = decision.id ?? `assumption ${index + 1}`;
    if (!blank(decision.userWhy)) return `failed: ${at} has a 'userWhy' — nobody told you why: the author is not in a chat with you. Put your reading of the reason in 'why', and what it rests on in 'basis'.`;
    if (blank(decision.basis)) return `failed: ${at} ("${decision.what.slice(0, 40)}") has no 'basis' — the evidence for the reason: the timing, a linked issue, the fix before it. A guess with nothing under it cannot be checked.`;
    if (!decision.confidence) return `failed: ${at} has no 'confidence' in its reason — high (someone said why), medium (the evidence points there), or low (a hunch from the code)`;
  }
  for (const [index, fork] of (input.forks ?? []).entries()) {
    const at = fork.id ?? `fork ${index + 1}`;
    if (blank(fork.basis)) return `failed: ${at} has no 'basis' — what tells you the other road was considered, or why this one was taken`;
    if (!fork.confidence) return `failed: ${at} has no 'confidence' — high, medium or low`;
  }
  return null;
};

/** The reader's own finish of a review in the room, the later of two: their
 *  take on it (a verdict) and, on one they filed, its close. `since`: its
 *  why was revised after the take. None while they have given neither. */
export const yourFinish = (ticket: Ticket, review: ReviewContext | undefined, me: string): YourReview | undefined => {
  const takes = ticket.steps.filter((step) => step.owner === me && isTake(step) && (step.status === "settled" || step.status === "failed"));
  const take = takes.reduce<(typeof takes)[number] | undefined>((latest, step) => (!latest || step.updatedAt >= latest.updatedAt ? step : latest), undefined);
  const taken: YourReview | undefined = take
    ? { as: take.status === "failed" ? "changes requested" : take.comment ? "commented" : "approved", at: take.updatedAt, since: review !== undefined && review.ts > take.updatedAt }
    : undefined;
  const ended = closedAs(ticket);
  const closed: YourReview | undefined = ended && ticket.closed && ticket.createdBy === me ? { as: ended === "done" ? "accepted" : "dropped", at: ticket.closed.ts, since: false } : undefined;
  if (!taken || !closed) return taken ?? closed;
  return closed.at >= taken.at ? closed : taken;
};

/** A finish as a line: "changes requested, 2026-10-24T09:12:00.000Z — changed since". */
export const finishLine = (finish: YourReview): string => `${finish.as}, ${new Date(finish.at).toISOString()}${finish.since ? " — changed since" : ""}`;
