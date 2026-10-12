import type { HostNote, HostReview, HostUser, LineComment, PullRequest } from "@collagen/review-web/data";
import { Schema } from "effect";
import type { HostMerge } from "../services/RepoHost";

// What `gh` answers, read into the review page's shapes. Pure: the calls
// are services/RepoHost's. Anything gh says that is not the shape asked for
// reads as nothing — a host is a network and a login away, and the page
// reads the diff without it.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const int = (v: unknown): number | undefined => (Number.isInteger(v) ? (v as number) : undefined);

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
export const readUser = (v: unknown): HostUser | null => {
  const o = obj(v);
  const login = str(o?.login);
  if (!o || !login) return null;
  return { login, ...(str(o.name) ? { name: str(o.name)! } : {}), ...(str(o.avatar_url) ? { avatarUrl: str(o.avatar_url)! } : {}) };
};

/** The fields asked of `gh pr view` / `gh pr list`. */
export const PULL_FIELDS = "number,url,title,state,isDraft,author,headRefOid,headRefName,baseRefName,reviewDecision,isCrossRepository,mergeCommit";

const DECISION: Readonly<Record<string, string>> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

/** One pull request as `gh pr view --json PULL_FIELDS` has it, with the head
 *  and base branches it joins (for a stack). `viewer`: the login signed in. */
export const readPull = (v: unknown, viewer: string | undefined): (PullRequest & { readonly branch: string; readonly base: string; readonly fork?: true; readonly merged?: string }) | null => {
  const o = obj(v);
  const number = int(o?.number);
  const url = str(o?.url);
  const head = str(o?.headRefOid);
  const branch = str(o?.headRefName);
  const base = str(o?.baseRefName);
  if (!o || number === undefined || !url || !head || !branch || !base) return null;
  const state = String(o.state).toLowerCase();
  const author = str(obj(o.author)?.login) ?? "";
  const decision = DECISION[String(o.reviewDecision)];
  const merged = state === "merged" ? str(obj(o.mergeCommit)?.oid) : undefined;
  return {
    number,
    url,
    title: str(o.title) ?? "",
    state: state === "merged" || state === "closed" ? state : "open",
    draft: o.isDraft === true,
    author,
    head,
    ...(decision ? { decision } : {}),
    mine: viewer !== undefined && author === viewer,
    branch,
    base,
    // its head on a fork: the branch is not on this repository's origin
    ...(o.isCrossRepository === true ? { fork: true as const } : {}),
    // the commit it went into its base as: a merge, a squash, the last of a rebase
    ...(merged ? { merged } : {}),
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

export const mergesPage = (answer: typeof MergesAnswer.Type): MergesPage => {
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

/** Pages from `gh api --paginate --slurp`, flattened. */
const pages = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v.flatMap((page) => (Array.isArray(page) ? page : [page])) : []);

/** `gh api --paginate --slurp repos/…/pulls/N/comments`: pages of comments,
 *  flattened. Comments GitHub no longer places on a line (outdated, the
 *  code under them moved) have no line to sit under — readOutdated reads those. */
export const readComments = (v: unknown): ReadonlyArray<LineComment> =>
  pages(v).flatMap((c): ReadonlyArray<LineComment> => {
    const comment = readComment(c);
    return comment ? [comment] : [];
  });

/** The line comments on code that has changed since they were written: no
 *  line now, so a note saying where they were. */
export const readOutdated = (v: unknown): ReadonlyArray<HostNote> =>
  pages(v).flatMap((c): ReadonlyArray<HostNote> => {
    const o = obj(c);
    const author = readUser(o?.user);
    const id = int(o?.id);
    if (!o || !author || id === undefined || o.line !== null) return [];
    const was = int(o.original_line);
    return [{ id: String(id), author, body: typeof o.body === "string" ? o.body : "", at: str(o.created_at) ?? "", url: str(o.html_url) ?? "", outdated: `${str(o.path) ?? "a file"}${was !== undefined ? `, line ${was}` : ""}` }];
  });

const VERDICT: Readonly<Record<string, HostReview["verdict"]>> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", COMMENTED: "commented", DISMISSED: "dismissed" };

/** `gh api --paginate --slurp repos/…/pulls/N/reviews`: each submitted review —
 *  a pending one is its author's alone, and a comment-only review that says
 *  nothing on the whole is just its line comments, shown under their lines. */
export const readReviews = (v: unknown): ReadonlyArray<HostReview> =>
  pages(v).flatMap((r): ReadonlyArray<HostReview> => {
    const o = obj(r);
    const author = readUser(o?.user);
    const id = int(o?.id);
    const verdict = VERDICT[String(o?.state)];
    if (!o || !author || id === undefined || !verdict) return [];
    const body = typeof o.body === "string" ? o.body.trim() : "";
    if (verdict === "commented" && body.length === 0) return [];
    return [{ id: String(id), author, verdict, body, at: str(o.submitted_at) ?? "", url: str(o.html_url) ?? "" }];
  });

/** `gh api --paginate --slurp repos/…/issues/N/comments`: the conversation. */
export const readConversation = (v: unknown): ReadonlyArray<HostNote> =>
  pages(v).flatMap((c): ReadonlyArray<HostNote> => {
    const o = obj(c);
    const author = readUser(o?.user);
    const id = int(o?.id);
    if (!o || !author || id === undefined) return [];
    return [{ id: String(id), author, body: typeof o.body === "string" ? o.body : "", at: str(o.created_at) ?? "", url: str(o.html_url) ?? "" }];
  });

/** One line comment, as GitHub's REST API has it. */
export const readComment = (v: unknown): LineComment | null => {
  const o = obj(v);
  const id = int(o?.id);
  const file = str(o?.path);
  const line = int(o?.line);
  const author = readUser(o?.user);
  if (!o || id === undefined || !file || line === undefined || !author) return null;
  // a block of lines names where it starts; one line names none (null)
  const startLine = int(o.start_line);
  return {
    id: String(id),
    author,
    body: typeof o.body === "string" ? o.body : "",
    file,
    line,
    side: o.side === "LEFT" ? "LEFT" : "RIGHT",
    ...(startLine !== undefined && startLine !== line ? { startLine, startSide: o.start_side === "LEFT" ? ("LEFT" as const) : ("RIGHT" as const) } : {}),
    url: str(o.html_url) ?? "",
    at: str(o.created_at) ?? "",
    ...(int(o.in_reply_to_id) !== undefined ? { replyTo: String(o.in_reply_to_id) } : {}),
  };
};

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
