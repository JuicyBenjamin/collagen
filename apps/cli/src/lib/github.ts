import type { HostNote, HostReview, HostUser, LineComment, PullRequest } from "@collagen/review-web/data";
import { Schema } from "effect";
import type { HostMerge, HostPull } from "../services/RepoHost";

// What `gh` answers: its JSON as schemas, decoded once where it comes in
// (services/RepoHost), and read into the review page's shapes by the small
// pure functions here.

/** The repository a GitHub link is in. */
export const githubRepo = (link: string): { readonly owner: string; readonly repo: string } | null => {
  const m = link.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
  return m ? { owner: m[1]!, repo: m[2]!.replace(/\.git$/, "") } : null;
};

/** The pull request a link names (…/pull/12, …/pull/12/files), if it names one. */
export const pullNumberIn = (link: string): number | null => {
  const m = link.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
};

/** What `gh api --paginate --slurp` prints: a page of items per request. */
export const Pages = <S extends Schema.Top>(item: S) => Schema.Array(Schema.Array(item));

const Side = Schema.Literals(["LEFT", "RIGHT"]);

/** Someone on GitHub: `gh api user`, or who wrote a comment. */
export const User = Schema.Struct({
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.String),
});
export type User = typeof User.Type;

export const toUser = (u: User): HostUser => ({ login: u.login, ...(u.name ? { name: u.name } : {}), ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}) });

/** The fields asked of `gh pr view` / `gh pr list`. */
export const PULL_FIELDS = "number,url,title,state,isDraft,author,headRefOid,headRefName,baseRefName,reviewDecision,isCrossRepository,mergeCommit";

/** One pull request as `gh pr view --json PULL_FIELDS` has it. */
export const Pull = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  author: Schema.Struct({ login: Schema.String }),
  headRefOid: Schema.String,
  headRefName: Schema.String,
  baseRefName: Schema.String,
  /** "" when the repository asks for no review */
  reviewDecision: Schema.Literals(["", "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]),
  isCrossRepository: Schema.Boolean,
  mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
});
export type Pull = typeof Pull.Type;

const STATE: Readonly<Record<Pull["state"], PullRequest["state"]>> = { OPEN: "open", CLOSED: "closed", MERGED: "merged" };
const DECISION: Readonly<Record<Pull["reviewDecision"], string | undefined>> = { "": undefined, APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

/** A pull request, with the head and base branches it joins (for a stack). */
export const toPull = (p: Pull): HostPull => {
  const decision = DECISION[p.reviewDecision];
  return {
    number: p.number,
    url: p.url,
    title: p.title,
    state: STATE[p.state],
    draft: p.isDraft,
    author: p.author.login,
    head: p.headRefOid,
    ...(decision ? { decision } : {}),
    branch: p.headRefName,
    base: p.baseRefName,
    // its head on a fork: the branch is not on this repository's origin
    ...(p.isCrossRepository ? { fork: true as const } : {}),
    // the commit it went into its base as: a merge, a squash, the last of a rebase
    ...(p.state === "MERGED" && p.mergeCommit ? { merged: p.mergeCommit.oid } : {}),
  };
};

/** The pull request a branch is: the open one, else the latest closed or
 *  merged — `gh pr list --head` lists newest first. */
export const pickPull = <P extends { readonly state: string }>(pulls: ReadonlyArray<P>): P | null => pulls.find((p) => p.state === "open") ?? pulls[0] ?? null;

/** The pull requests merged into a branch, as GraphQL has them, a page at
 *  a time: no merge kind is stored, so it is read from the commit that
 *  landed — two parents is a merge; one, the very head, is a fast-forward;
 *  one, with the last commit's words and author date kept, is a rebase;
 *  else a squash. */
export const MERGES_QUERY = `query($owner: String!, $repo: String!, $base: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(baseRefName: $base, states: MERGED, first: 100, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url headRefName mergedAt updatedAt
        mergeCommit { oid messageHeadline authoredDate parents { totalCount } }
        commits(last: 1) { totalCount nodes { commit { oid messageHeadline authoredDate } } }
      }
    }
  }
}`;

const Commit = Schema.Struct({ oid: Schema.String, messageHeadline: Schema.String, authoredDate: Schema.String });

/** A merged pull request, as MERGES_QUERY has it. */
const MergedPull = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  headRefName: Schema.String,
  mergedAt: Schema.String,
  updatedAt: Schema.String,
  /** null once its history was rewritten: nothing on the branch to point at */
  mergeCommit: Schema.NullOr(Schema.Struct({ ...Commit.fields, parents: Schema.Struct({ totalCount: Schema.Int }) })),
  commits: Schema.Struct({ totalCount: Schema.Int, nodes: Schema.Array(Schema.Struct({ commit: Commit })) }),
});
export type MergedPull = typeof MergedPull.Type;

/** One page of MERGES_QUERY's answer. */
export const MergesAnswer = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      pullRequests: Schema.Struct({
        pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
        nodes: Schema.Array(MergedPull),
      }),
    }),
  }),
});
export type MergesAnswer = typeof MergesAnswer.Type;

/** How a pull request landed, read from the commit it landed as; null when
 *  that commit is gone. */
export const landedAs = (p: MergedPull): HostMerge | null => {
  const landed = p.mergeCommit;
  if (!landed) return null;
  const last = p.commits.nodes.at(-1)?.commit;
  const kind: HostMerge["kind"] =
    landed.parents.totalCount > 1
      ? "merge"
      : last?.oid === landed.oid
        ? "fast-forward"
        : last?.messageHeadline === landed.messageHeadline && last.authoredDate === landed.authoredDate
          ? "rebase"
          : "squash";
  return { number: p.number, url: p.url, title: p.title, branch: p.headRefName, kind, commit: landed.oid, commits: p.commits.totalCount, at: p.mergedAt };
};

/** One page of merges: those that landed, when the least recently changed
 *  of its pull requests last changed, and the cursor to the next page. */
export interface MergesPage {
  readonly merges: ReadonlyArray<HostMerge>;
  readonly oldestUpdate: string | null;
  readonly next: string | null;
}

export const mergesPage = (answer: MergesAnswer): MergesPage => {
  const { pageInfo, nodes } = answer.data.repository.pullRequests;
  return {
    merges: nodes.flatMap((p) => landedAs(p) ?? []),
    oldestUpdate: nodes.map((p) => p.updatedAt).sort()[0] ?? null,
    next: pageInfo.hasNextPage ? pageInfo.endCursor : null,
  };
};

/** The latest `limit` merges of the pages read so far, the latest first —
 *  and whether they are surely the latest of all. Pages come in the order
 *  pull requests last changed, and a pull request changes no earlier than
 *  it merged: once the last page read changed before the `limit`th merge,
 *  no page after it holds a later one. */
export const latestMerges = (pages: ReadonlyArray<MergesPage>, limit: number): { readonly merges: ReadonlyArray<HostMerge>; readonly done: boolean } => {
  // a pull request changed while the pages were read can be on two of them
  const merges = [...new Map(pages.flatMap((p) => p.merges).map((m) => [m.number, m] as const)).values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
  const last = pages.at(-1);
  const cutoff = merges[limit - 1]?.at;
  const done = !last || last.next === null || (cutoff !== undefined && last.oldestUpdate !== null && last.oldestUpdate <= cutoff);
  return { merges, done };
};

/** A line comment on a pull request, as GitHub's REST API has it. */
export const PullComment = Schema.Struct({
  id: Schema.Int,
  user: User,
  body: Schema.String,
  path: Schema.String,
  /** null once the code under it changed: GitHub no longer places it on a line */
  line: Schema.NullOr(Schema.Int),
  original_line: Schema.optional(Schema.NullOr(Schema.Int)),
  side: Schema.optional(Side),
  /** where a block of lines starts; one line names none */
  start_line: Schema.optional(Schema.NullOr(Schema.Int)),
  start_side: Schema.optional(Schema.NullOr(Side)),
  in_reply_to_id: Schema.optional(Schema.Int),
  html_url: Schema.String,
  created_at: Schema.String,
});
export type PullComment = typeof PullComment.Type;

/** A comment on the line it sits on now; null for one on code changed since. */
export const toLineComment = (c: PullComment): LineComment | null =>
  c.line === null
    ? null
    : {
        id: String(c.id),
        author: toUser(c.user),
        body: c.body,
        file: c.path,
        line: c.line,
        side: c.side ?? "RIGHT",
        ...(c.start_line != null && c.start_line !== c.line ? { startLine: c.start_line, startSide: c.start_side ?? "RIGHT" } : {}),
        url: c.html_url,
        at: c.created_at,
        ...(c.in_reply_to_id !== undefined ? { replyTo: String(c.in_reply_to_id) } : {}),
      };

/** A pull request's line comments: those on a line now, and those on code
 *  changed since — no line to sit under, so a note saying where they were. */
export const splitComments = (cs: ReadonlyArray<PullComment>): { readonly inline: ReadonlyArray<LineComment>; readonly outdated: ReadonlyArray<HostNote> } => ({
  inline: cs.flatMap((c) => toLineComment(c) ?? []),
  outdated: cs.flatMap((c): ReadonlyArray<HostNote> =>
    c.line === null ? [{ id: String(c.id), author: toUser(c.user), body: c.body, at: c.created_at, url: c.html_url, outdated: `${c.path}${c.original_line != null ? `, line ${c.original_line}` : ""}` }] : [],
  ),
});

/** A review on a pull request; `submitted_at` only once it is submitted. */
export const Review = Schema.Struct({
  id: Schema.Int,
  user: Schema.NullOr(User),
  body: Schema.String,
  state: Schema.Literals(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]),
  submitted_at: Schema.optional(Schema.String),
  html_url: Schema.String,
});
export type Review = typeof Review.Type;

const VERDICT: Readonly<Record<Review["state"], HostReview["verdict"] | null>> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", COMMENTED: "commented", DISMISSED: "dismissed", PENDING: null };

/** A submitted review — a pending one is its author's alone, and a
 *  comment-only review that says nothing on the whole is just its line
 *  comments, shown under their lines: both null. */
export const toReview = (r: Review): HostReview | null => {
  const verdict = VERDICT[r.state];
  const body = r.body.trim();
  if (verdict === null || r.user === null || (verdict === "commented" && body.length === 0)) return null;
  return { id: String(r.id), author: toUser(r.user), verdict, body, at: r.submitted_at ?? "", url: r.html_url };
};

/** What `POST …/reviews` answers. */
export const CreatedReview = Schema.Struct({ id: Schema.Int, html_url: Schema.String });

/** A comment in a pull request's conversation (`…/issues/N/comments`). */
export const IssueComment = Schema.Struct({
  id: Schema.Int,
  user: Schema.NullOr(User),
  body: Schema.optional(Schema.String),
  created_at: Schema.String,
  html_url: Schema.String,
});
export type IssueComment = typeof IssueComment.Type;

/** The conversation, comment by comment; one by a deleted account, none. */
export const toNote = (c: IssueComment): HostNote | null => (c.user === null ? null : { id: String(c.id), author: toUser(c.user), body: c.body ?? "", at: c.created_at, url: c.html_url });

/** What gh said when it refused, in a line: its own words, without the
 *  "gh: " and HTTP noise around them. */
export const refusal = (stderr: string): string => {
  const line =
    stderr
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const said = line.replace(/^(gh: |error: |failed to [^:]+: )/i, "").replace(/\s*\(HTTP \d+\)\s*$/, "");
  return said.length > 0 ? said : "GitHub refused it";
};
