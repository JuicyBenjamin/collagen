import { IMPORTANCE, type Assumed, type BugReport, type Confidence, type OutlineItem, type ReviewContext, type ReviewDecision, type ReviewFork } from "@collagen/p2p";

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
  const t = title?.trim() ?? "";
  if (LINE_BREAK.test(t)) return `failed: the title runs over more than one line — a headline is one line (each break would take a row of the list); put the rest in the goal, beneath it`;
  if (t.length === 0) return `failed: pass a 'title' — the ticket's headline, a few words (${TITLE_MAX} characters at most) saying what it is for; the lists show it, and the goal is the line beneath it`;
  if (t.length > TITLE_MAX) return `failed: the title is ${t.length} characters ("${t.slice(0, 40)}…") — a title is a headline of a few words, ${TITLE_MAX} at most; the detail belongs in the goal, beneath it`;
  return null;
};

/** Why a unit's title cannot stand, or null: a unit is titled by what it
 *  achieves — "Big exports finish" — never by a file or a path, which says
 *  where the code is and not why it is there. The reader navigates by these. */
export const unitTitleGap = (title: string, what: string): string | null => {
  const gap = ticketTitleGap(title);
  if (gap) return gap.replace("the ticket's headline", `a unit's title`).replace("the lists show it, and the goal is the line beneath it", "the review page lists units by it");
  const t = title.trim();
  // a path, or nothing but file names ("Mcp.ts", "export.ts · use.ts") —
  // "Node.js upgrade" and "v1.2 release notes" are purposes and pass
  const words = t.split(/[\s,·&+]+|\band\b/).filter((w) => w.length > 0);
  if (/[\\/]/.test(t) || (words.length > 0 && words.every((w) => /^[\w.-]*\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(w) && !/^\d/.test(w.split(".").pop()!))))
    return `failed: unit "${t}" is titled by a file — title it by what it achieves ("Big exports finish", "Typos caught before merge"); the files go in its 'where'`;
  if (what.trim().length === 0) return `failed: unit "${t}" has no 'what' — the line beneath its title: what that code does, in a line`;
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
  /** the why is inferred, not told (see p2p Assumed) */
  readonly assumed?: Assumed;
}

const blank = (s: string | undefined): boolean => (s ?? "").trim().length === 0;

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
  const unitsMove = (input.units?.length ?? 0) > 0 || (input.retireUnits?.length ?? 0) > 0;
  if (amending && decisions.length === 0 && forks.length === 0 && blank(input.summary) && blank(input.branch) && blank(input.base) && blank(input.link) && !outlineMoves && !bugMoves && !unitsMove) {
    return "failed: nothing to amend — pass the decisions, forks or fields you are adding";
  }
  for (const [i, d] of decisions.entries()) {
    const at = d.id ?? `decision ${i + 1}`;
    if (blank(d.what)) return `failed: ${at} has no 'what' — say what was decided in one line`;
    if (blank(d.title)) {
      return `failed: ${at} ("${d.what.slice(0, 40)}") has no 'title'. Every decision needs one: its headline, a few words (${TITLE_MAX} characters at most) saying what it is for — the reader sees it before anything else, so it has to say the purpose at a glance. 'what' stays the one line beneath it.`;
    }
    if (LINE_BREAK.test(d.title.trim())) return `failed: ${at}'s title runs over more than one line — a headline is one line; the rest belongs in 'what', beneath it`;
    if (d.title.trim().length > TITLE_MAX) {
      return `failed: ${at}'s title is ${d.title.trim().length} characters ("${d.title.slice(0, 40)}…") — a title is a headline of a few words, ${TITLE_MAX} at most: what the decision is for, not how. The detail belongs in 'what', beneath it.`;
    }
    if (blank(d.userWhy) && blank(d.agentWhy)) {
      return `failed: ${at} ("${d.what.slice(0, 40)}") has no why. 'userWhy' is how your user steered it — what they asked for or ruled out, in their words where you have them; 'agentWhy' is your own reason. One of them at least, or the reviewer is guessing again.`;
    }
  }
  for (const [i, f] of forks.entries()) {
    const at = f.id ?? `fork ${i + 1}`;
    if (blank(f.at)) return `failed: ${at} has no 'at' — point at the code the choice produced (file:line)`;
    if (blank(f.chose) || blank(f.instead)) return `failed: ${at} needs both roads: 'chose' and 'instead'`;
    if (blank(f.why)) return `failed: ${at} has no 'why' — enough for the reviewer to judge the turn, not an essay`;
  }
  return null;
};

/** One line: where the code is and how much why came with it. The link is
 *  left out where the line has to fit a terminal row — the page shows it. */
export const reviewHeadline = (r: ReviewContext, opts?: { readonly link?: boolean }): string => {
  const where = r.branch ? (r.base ? `${r.branch} → ${r.base}` : r.branch) : "";
  return [where, (opts?.link ?? true) ? (r.link ?? "") : "", `${r.decisions.length} decision${r.decisions.length === 1 ? "" : "s"}`, `${r.forks.length} fork${r.forks.length === 1 ? "" : "s"}`]
    .filter((x) => x.length > 0)
    .join(" · ");
};

const hay = (d: ReviewDecision | ReviewFork | OutlineItem): string =>
  Object.values(d)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();

/** The whole why, or the part of it that is about something — a file, a
 *  symbol, a phrase the reader just used ("the retry loop"). Filtering keeps
 *  a big review answerable one question at a time. */
export const reviewRows = (r: ReviewContext, about?: string) => {
  const q = (about ?? "").trim().toLowerCase();
  const keep = <T extends ReviewDecision | ReviewFork | OutlineItem>(xs: ReadonlyArray<T>): ReadonlyArray<T> =>
    q.length === 0 ? xs : xs.filter((x) => hay(x).includes(q));
  const decisions = keep(r.decisions);
  const forks = keep(r.forks);
  // a proposal's outline is searched like the rest: "bob" finds the item he
  // is suggested for, "mailer" the item about the mailer
  const outline = keep(r.outline ?? []);
  // the bug report is one block: it is in the answer when nothing is asked
  // about, or when the question touches any of its words
  const bug = r.bug && (q.length === 0 || hayBug(r.bug).includes(q)) ? r.bug : undefined;
  return {
    review: {
      by: r.authorName,
      ...(r.branch ? { branch: r.base ? `${r.branch} → ${r.base}` : r.branch } : {}),
      ...(r.link ? { link: r.link } : {}),
      summary: r.summary,
      // nobody told this why: it was inferred, and from what
      ...(r.assumed ? { assumed: `${r.assumed.author} does not use collagen: every decision and fork here is ${r.authorName}'s AI's guess at their why, inferred from ${r.assumed.sources.join(", ")} — each says what it rests on and how sure it is` } : {}),
      // reviews outlive the first read: this is the why as it stands NOW
      updated: new Date(r.ts).toISOString(),
      ...(q.length > 0
        ? {
            about: q,
            matched: `${decisions.length} of ${r.decisions.length} decisions, ${forks.length} of ${r.forks.length} forks${r.outline && r.outline.length > 0 ? `, ${outline.length} of ${r.outline.length} outline items` : ""}${r.bug ? `, the bug report ${bug ? "matched" : "did not match"}` : ""}`,
          }
        : {}),
    },
    decisions: decisions.map((d) =>
      r.assumed
        ? { id: d.id, title: d.title ?? NO_TITLE, what: d.what, assumedWhy: d.agentWhy ?? "", basis: d.basis ?? "", confidence: d.confidence ?? "", where: d.where.join(" ") }
        : {
            id: d.id,
            title: d.title ?? NO_TITLE,
            what: d.what,
            userWhy: d.userWhy ?? "",
            agentWhy: d.agentWhy ?? "",
            where: d.where.join(" "),
            guidedBy: (d.guidedBy ?? []).join(", "),
          },
    ),
    forks: forks.map((f) => (r.assumed ? { id: f.id, at: f.at, chose: f.chose, instead: f.instead, why: f.why, basis: f.basis ?? "", confidence: f.confidence ?? "" } : { id: f.id, at: f.at, chose: f.chose, instead: f.instead, why: f.why, by: f.by ?? "" })),
    // how the change reads, as its author's agent grouped it
    ...(r.units && r.units.length > 0 ? { units: r.units.map((u) => ({ id: u.id, title: u.title, ...(u.what ? { what: u.what } : {}), where: u.where.join(" ") })) } : {}),
    // a proposal's outline: what the work might be and who might do it — the
    // author's suggestion, binding on nobody; a plan lifts it into real steps
    ...(outline.length > 0 ? { outline: outline.map((o) => ({ id: o.id, intent: o.intent, description: o.description, owner: o.owner ?? "" })) } : {}),
    // a bug's report, whole: the symptom is the fact, the rest the reporter's reading
    ...(bug ? { bug: bugRows(bug) } : {}),
  };
};

/** Searched exactly as rendered — the score and its anchor included, so
 *  "4" and "blocking" find the report the reader would see them in. */
const hayBug = (b: BugReport): string => Object.values(bugRows(b)).join(" ").toLowerCase();

/** The report as a reader gets it: the score with its anchor spelled out, so
 *  "3" reads as "3 — wrong: a feature fails for some" and not as a number. */
export const bugRows = (b: BugReport) => ({
  symptom: b.symptom,
  ...(b.cause ? { cause: b.cause.what, where: b.cause.where.join(" ") } : {}),
  ...(b.importance ? { importance: `${b.importance.score} — ${IMPORTANCE[b.importance.score]}`, effect: b.importance.effect } : {}),
  ...(b.suggestion ? { suggestion: b.suggestion.what, requirements: b.suggestion.requirements.join("; ") } : {}),
  ...(b.remedy ? { remedy: `${b.remedy} — ${REMEDY_WORDS[b.remedy]}` } : {}),
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
  const a = input.assumed;
  if (!amending && (!a || blank(a.author))) return "failed: pass 'author' — who wrote the code (their login on the host, or their name); with a pull request link it is read from the host";
  if (!amending && (a?.sources ?? []).filter((x) => !blank(x)).length === 0) {
    return "failed: pass 'sources' — what you read to infer the why: the pull request's description, its commits, a linked ticket (\"JIRA-123\"), the code itself. A reader weighs a guess by what it rests on.";
  }
  for (const [i, d] of (input.decisions ?? []).entries()) {
    const at = d.id ?? `assumption ${i + 1}`;
    if (!blank(d.userWhy)) return `failed: ${at} has a 'userWhy' — nobody told you why: the author is not in a chat with you. Put your reading of the reason in 'why', and what it rests on in 'basis'.`;
    if (blank(d.basis)) return `failed: ${at} ("${d.what.slice(0, 40)}") has no 'basis' — what you inferred it from: a line of the pull request's description, a commit message, a ticket, the shape of the code. A guess with nothing under it cannot be checked.`;
    if (!d.confidence) return `failed: ${at} has no 'confidence' — high (the author said as much), medium (the code makes it likely), or low (a reading of the code, nothing more)`;
  }
  for (const [i, f] of (input.forks ?? []).entries()) {
    const at = f.id ?? `fork ${i + 1}`;
    if (blank(f.basis)) return `failed: ${at} has no 'basis' — what tells you the other road was considered, or why this one was taken`;
    if (!f.confidence) return `failed: ${at} has no 'confidence' — high, medium or low`;
  }
  return null;
};
