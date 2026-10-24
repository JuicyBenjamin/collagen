import type { CommentSpot, HostNote, HostReview, HostUser, LineComment, PullRequest } from "@collagen/review-web/data";
import { Schema } from "effect";
import type { HostMerge } from "../services/RepoHost";
import type { HostReadiness } from "./merging";

// What `gh` answers, read into the review page's shapes. Pure: the calls
// are services/RepoHost's. Anything gh says that is not the shape asked for
// reads as nothing — a host is a network and a login away, and the page
// reads the diff without it.

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null);
const asText = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
const asInteger = (value: unknown): number | undefined => (Number.isInteger(value) ? (value as number) : undefined);

/** The repository a GitHub link is in. */
export const githubRepo = (link: string): { readonly owner: string; readonly repo: string } | null => {
  const match = link.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
  return match ? { owner: match[1]!, repo: match[2]!.replace(/\.git$/, "") } : null;
};

/** The pull request a link names (…/pull/12, …/pull/12/files), if it names one. */
export const pullNumberIn = (link: string): number | null => {
  const match = link.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  return match ? Number(match[1]) : null;
};

/** JSON from gh, or null. */
export const parse = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** `gh api user`. */
export const readUser = (value: unknown): HostUser | null => {
  const record = asRecord(value);
  const login = asText(record?.login);
  if (!record || !login) return null;
  return { login, ...(asText(record.name) ? { name: asText(record.name)! } : {}), ...(asText(record.avatar_url) ? { avatarUrl: asText(record.avatar_url)! } : {}) };
};

/** The fields asked of `gh pr view` / `gh pr list`. */
export const PULL_FIELDS = "number,url,title,state,isDraft,author,headRefOid,headRefName,baseRefName,reviewDecision,isCrossRepository,mergeCommit";

const DECISION: Readonly<Record<string, string>> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

/** One pull request as `gh pr view --json PULL_FIELDS` has it, with the head
 *  and base branches it joins (for a stack). `viewer`: the login signed in. */
export const readPull = (value: unknown, viewer: string | undefined): (PullRequest & { readonly branch: string; readonly base: string; readonly fork?: true; readonly merged?: string }) | null => {
  const record = asRecord(value);
  const number = asInteger(record?.number);
  const url = asText(record?.url);
  const head = asText(record?.headRefOid);
  const branch = asText(record?.headRefName);
  const base = asText(record?.baseRefName);
  if (!record || number === undefined || !url || !head || !branch || !base) return null;
  const state = String(record.state).toLowerCase();
  const author = asText(asRecord(record.author)?.login) ?? "";
  const decision = DECISION[String(record.reviewDecision)];
  const merged = state === "merged" ? asText(asRecord(record.mergeCommit)?.oid) : undefined;
  return {
    number,
    url,
    title: asText(record.title) ?? "",
    state: state === "merged" || state === "closed" ? state : "open",
    draft: record.isDraft === true,
    author,
    head,
    ...(decision ? { decision } : {}),
    mine: viewer !== undefined && author === viewer,
    branch,
    base,
    // its head on a fork: the branch is not on this repository's origin
    ...(record.isCrossRepository === true ? { fork: true as const } : {}),
    // the commit it went into its base as: a merge, a squash, the last of a rebase
    ...(merged ? { merged } : {}),
  };
};

/** The pull request a branch is: the open one, else the latest closed or
 *  merged — `gh pr list --head` lists newest first. */
export const pickPull = <P extends { readonly state: string }>(pulls: ReadonlyArray<P>): P | null => pulls.find((pull) => pull.state === "open") ?? pulls[0] ?? null;

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

/** One page of MERGES_QUERY's answer, as gh prints it. */
export const MergesAnswer = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Struct({
      repository: Schema.Struct({
        pullRequests: Schema.Struct({
          pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
          nodes: Schema.Array(MergedPull),
        }),
      }),
    }),
  }),
);

/** How a pull request landed, read from the commit it landed as; null when
 *  that commit is gone. */
export const landedAs = (pull: MergedPull): HostMerge | null => {
  const landed = pull.mergeCommit;
  if (!landed) return null;
  const last = pull.commits.nodes.at(-1)?.commit;
  const kind: HostMerge["kind"] =
    landed.parents.totalCount > 1
      ? "merge"
      : last?.oid === landed.oid
        ? "fast-forward"
        : last?.messageHeadline === landed.messageHeadline && last.authoredDate === landed.authoredDate
          ? "rebase"
          : "squash";
  return { number: pull.number, url: pull.url, title: pull.title, branch: pull.headRefName, kind, commit: landed.oid, commits: pull.commits.totalCount, at: pull.mergedAt };
};

/** One page of merges: those that landed, when the least recently changed
 *  of its pull requests last changed, and the cursor to the next page. */
export interface MergesPage {
  readonly merges: ReadonlyArray<HostMerge>;
  readonly oldestUpdate: string | null;
  readonly next: string | null;
}

export const mergesPage = (answer: typeof MergesAnswer.Type): MergesPage => {
  const { pageInfo, nodes } = answer.data.repository.pullRequests;
  return {
    merges: nodes.flatMap((pull) => landedAs(pull) ?? []),
    oldestUpdate: nodes.map((pull) => pull.updatedAt).sort()[0] ?? null,
    next: pageInfo.hasNextPage ? pageInfo.endCursor : null,
  };
};

/** The latest `limit` merges of the pages read so far, the latest first;
 *  whether they are surely the latest of all; and whether there are more
 *  past them. Pages come in the order pull requests last changed, and a
 *  pull request changes no earlier than it merged: once the last page read
 *  changed before the `limit`th merge, no page after it holds a later one. */
export const latestMerges = (
  pages: ReadonlyArray<MergesPage>,
  limit: number,
): { readonly merges: ReadonlyArray<HostMerge>; readonly done: boolean; readonly more: boolean } => {
  // a pull request changed while the pages were read can be on two of them
  const all = [...new Map(pages.flatMap((page) => page.merges).map((merge) => [merge.number, merge] as const)).values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const merges = all.slice(0, limit);
  const last = pages.at(-1);
  const cutoff = merges[limit - 1]?.at;
  const done = !last || last.next === null || (cutoff !== undefined && last.oldestUpdate !== null && last.oldestUpdate <= cutoff);
  return { merges, done, more: all.length > limit || (last !== undefined && last.next !== null) };
};

/** Pages from `gh api --paginate --slurp`, flattened. */
const pages = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value.flatMap((page) => (Array.isArray(page) ? page : [page])) : []);

/** `gh api --paginate --slurp repos/…/pulls/N/comments`: pages of comments,
 *  flattened: on lines, or on a whole file. Comments GitHub no longer places
 *  on a line (outdated, the code under them moved) have no line to sit under
 *  — readOutdated reads those. */
export const readComments = (value: unknown): ReadonlyArray<LineComment> =>
  pages(value).flatMap((entry): ReadonlyArray<LineComment> => {
    const comment = readComment(entry);
    return comment ? [comment] : [];
  });

/** One review's line comments, read from the pull request's (`gh api
 *  --paginate --slurp repos/…/pulls/N/comments`): GitHub's own list of a
 *  review's comments leaves out the lines they are on. Each is where it was
 *  written — on code changed since, the line it had then. */
export const readReviewComments = (value: unknown, reviewId: number): ReadonlyArray<LineComment> =>
  pages(value).flatMap((entry): ReadonlyArray<LineComment> => {
    const record = asRecord(entry);
    if (!record || record.pull_request_review_id !== reviewId) return [];
    const moved = record.line === null && asInteger(record.original_line) !== undefined;
    const comment = readComment(moved ? { ...record, line: record.original_line, start_line: record.original_start_line ?? null } : record);
    return comment ? [comment] : [];
  });

/** The line comments on code that has changed since they were written: no
 *  line now, so a note saying where they were. */
export const readOutdated = (value: unknown): ReadonlyArray<HostNote> =>
  pages(value).flatMap((comment): ReadonlyArray<HostNote> => {
    const record = asRecord(comment);
    const author = readUser(record?.user);
    const id = asInteger(record?.id);
    // a comment on a whole file has no line either: it is read with the rest
    if (!record || !author || id === undefined || record.line !== null || record.subject_type === "file") return [];
    const was = asInteger(record.original_line);
    return [{ id: String(id), author, body: typeof record.body === "string" ? record.body : "", at: asText(record.created_at) ?? "", url: asText(record.html_url) ?? "", outdated: `${asText(record.path) ?? "a file"}${was !== undefined ? `, line ${was}` : ""}` }];
  });

const VERDICT: Readonly<Record<string, HostReview["verdict"]>> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", COMMENTED: "commented", DISMISSED: "dismissed" };

/** `gh api --paginate --slurp repos/…/pulls/N/reviews`: each submitted review —
 *  a pending one is its author's alone, and a comment-only review that says
 *  nothing on the whole is just its line comments, shown under their lines. */
export const readReviews = (value: unknown): ReadonlyArray<HostReview> =>
  pages(value).flatMap((review): ReadonlyArray<HostReview> => {
    const record = asRecord(review);
    const author = readUser(record?.user);
    const id = asInteger(record?.id);
    const verdict = VERDICT[String(record?.state)];
    if (!record || !author || id === undefined || !verdict) return [];
    const body = typeof record.body === "string" ? record.body.trim() : "";
    if (verdict === "commented" && body.length === 0) return [];
    const commit = asText(record.commit_id);
    return [{ id: String(id), author, verdict, body, at: asText(record.submitted_at) ?? "", url: asText(record.html_url) ?? "", ...(commit ? { commit } : {}) }];
  });

/** `gh api --paginate --slurp repos/…/issues/N/comments`: the conversation. */
export const readConversation = (value: unknown): ReadonlyArray<HostNote> =>
  pages(value).flatMap((comment): ReadonlyArray<HostNote> => {
    const record = asRecord(comment);
    const author = readUser(record?.user);
    const id = asInteger(record?.id);
    if (!record || !author || id === undefined) return [];
    return [{ id: String(id), author, body: typeof record.body === "string" ? record.body : "", at: asText(record.created_at) ?? "", url: asText(record.html_url) ?? "" }];
  });

/** One review comment, as GitHub's REST API has it: on a line, a block of
 *  lines, or a whole file (`subject_type: "file"`, no line). */
export const readComment = (value: unknown): LineComment | null => {
  const record = asRecord(value);
  const id = asInteger(record?.id);
  const file = asText(record?.path);
  const line = asInteger(record?.line);
  const author = readUser(record?.user);
  if (!record || id === undefined || !file || !author) return null;
  // a block of lines names where it starts; one line names none (null)
  const startLine = asInteger(record.start_line);
  const spot: CommentSpot | null =
    record.subject_type === "file"
      ? { subject: "file", file }
      : line === undefined
        ? null
        : { file, line, side: record.side === "LEFT" ? "LEFT" : "RIGHT", ...(startLine !== undefined && startLine !== line ? { startLine, startSide: record.start_side === "LEFT" ? ("LEFT" as const) : ("RIGHT" as const) } : {}) };
  if (!spot) return null;
  return {
    id: String(id),
    author,
    body: typeof record.body === "string" ? record.body : "",
    ...spot,
    url: asText(record.html_url) ?? "",
    at: asText(record.created_at) ?? "",
    ...(asInteger(record.in_reply_to_id) !== undefined ? { replyTo: String(record.in_reply_to_id) } : {}),
  };
};

/** What gh said when it refused, in a line: its own words, without the
 *  "gh: " and HTTP noise around them. */
export const refusal = (stderr: string): string => {
  const line =
    stderr
      .split("\n")
      .map((text) => text.trim())
      .find((text) => text.length > 0) ?? "";
  const said = line.replace(/^(gh: |error: |failed to [^:]+: )/i, "").replace(/\s*\(HTTP \d+\)\s*$/, "");
  return said.length > 0 ? said : "GitHub refused it";
};

/** What `gh pr view` is asked for to judge whether a pull request can be merged. */
export const READINESS_FIELDS = "state,isDraft,mergeable,reviewDecision,statusCheckRollup";

/** A check's state, from either kind GitHub reports: a check run (status,
 *  conclusion) or a commit status (state). */
const checkState = (check: Json): "passing" | "pending" | "failing" => {
  const conclusion = asText(check.conclusion)?.toUpperCase();
  const status = asText(check.status)?.toUpperCase();
  const state = asText(check.state)?.toUpperCase();
  if (state) return state === "SUCCESS" ? "passing" : state === "PENDING" || state === "EXPECTED" ? "pending" : "failing";
  if (status && status !== "COMPLETED") return "pending";
  return conclusion === undefined || ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion) ? "passing" : "failing";
};

/** `gh pr view --json READINESS_FIELDS`, as merging reads it. */
export const readReadiness = (value: unknown): HostReadiness | null => {
  const record = asRecord(value);
  const state = asText(record?.state)?.toUpperCase();
  if (!record || !state) return null;
  const checks = (Array.isArray(record.statusCheckRollup) ? record.statusCheckRollup : []).flatMap((check) => {
    const each = asRecord(check);
    return each ? [checkState(each)] : [];
  });
  const mergeable = asText(record.mergeable)?.toUpperCase();
  const decision = asText(record.reviewDecision)?.toUpperCase();
  return {
    state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open",
    draft: record.isDraft === true,
    checks: checks.length === 0 ? "none" : checks.includes("failing") ? "failing" : checks.includes("pending") ? "pending" : "passing",
    conflicts: mergeable === "CONFLICTING" ? true : mergeable === "MERGEABLE" ? false : null,
    approvalRequired: decision === "REVIEW_REQUIRED",
    changesRequested: decision === "CHANGES_REQUESTED",
  };
};

/** The repository's default way to merge, as GitHub offers them: a merge
 *  commit, then squash, then rebase — the first it allows. */
export const defaultMergeMethod = (value: unknown): "merge" | "squash" | "rebase" | null => {
  const record = asRecord(value);
  if (!record) return null;
  if (record.mergeCommitAllowed === true) return "merge";
  if (record.squashMergeAllowed === true) return "squash";
  if (record.rebaseMergeAllowed === true) return "rebase";
  return null;
};
