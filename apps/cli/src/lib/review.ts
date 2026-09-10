import type { ReviewContext, ReviewDecision, ReviewFork } from "@collagen/p2p";

/** A review's why, as the agent hands it over and as a reader gets it back.
 *  The point of the whole thing: a diff shows the what, and the reviewer has
 *  to guess the why. Here the why is data — the person's steering and the
 *  agent's reasoning, plus every fork where the work could have gone another
 *  way, each pointing at the code it produced. */

export interface DecisionInput {
  readonly id?: string;
  readonly what: string;
  readonly userWhy?: string;
  readonly agentWhy?: string;
  readonly where?: ReadonlyArray<string>;
}
export interface ForkInput {
  readonly id?: string;
  readonly at: string;
  readonly chose: string;
  readonly instead: string;
  readonly why: string;
  readonly by?: "user" | "agent";
}
export interface ReviewInput {
  readonly summary?: string;
  readonly branch?: string;
  readonly base?: string;
  readonly link?: string;
  readonly decisions?: ReadonlyArray<DecisionInput>;
  readonly forks?: ReadonlyArray<ForkInput>;
}

const blank = (s: string | undefined): boolean => (s ?? "").trim().length === 0;

/** What is missing before this is worth a reviewer's time, said as the thing
 *  to go and do. A review without the why is the status quo, so the tool
 *  refuses it rather than sending half of one. `amending` relaxes the
 *  wholesale checks: a later call adds to a review that already stands. */
export const reviewGaps = (input: ReviewInput, amending: boolean): string | null => {
  const decisions = input.decisions ?? [];
  const forks = input.forks ?? [];
  if (!amending && blank(input.summary)) {
    return "failed: pass a summary — what the change does, in your user's terms, not a commit list";
  }
  if (!amending && decisions.length === 0) {
    return "failed: pass the decisions behind the change. Read back over THIS conversation and take them from it: what your user asked for, what they prefaced, what they ruled out, what you chose on your own and why. A review with no why is the review they already get from a diff.";
  }
  if (amending && decisions.length === 0 && forks.length === 0 && blank(input.summary) && blank(input.branch) && blank(input.base) && blank(input.link)) {
    return "failed: nothing to amend — pass the decisions, forks or fields you are adding";
  }
  for (const [i, d] of decisions.entries()) {
    const at = d.id ?? `decision ${i + 1}`;
    if (blank(d.what)) return `failed: ${at} has no 'what' — say what was decided in one line`;
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

const hay = (d: ReviewDecision | ReviewFork): string =>
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
  const keep = <T extends ReviewDecision | ReviewFork>(xs: ReadonlyArray<T>): ReadonlyArray<T> =>
    q.length === 0 ? xs : xs.filter((x) => hay(x).includes(q));
  const decisions = keep(r.decisions);
  const forks = keep(r.forks);
  return {
    review: {
      by: r.authorName,
      ...(r.branch ? { branch: r.base ? `${r.branch} → ${r.base}` : r.branch } : {}),
      ...(r.link ? { link: r.link } : {}),
      summary: r.summary,
      // reviews outlive the first read: this is the why as it stands NOW
      updated: new Date(r.ts).toISOString(),
      ...(q.length > 0 ? { about: q, matched: `${decisions.length} of ${r.decisions.length} decisions, ${forks.length} of ${r.forks.length} forks` } : {}),
    },
    decisions: decisions.map((d) => ({
      id: d.id,
      what: d.what,
      userWhy: d.userWhy ?? "",
      agentWhy: d.agentWhy ?? "",
      where: d.where.join(" "),
    })),
    forks: forks.map((f) => ({ id: f.id, at: f.at, chose: f.chose, instead: f.instead, why: f.why, by: f.by ?? "" })),
  };
};
