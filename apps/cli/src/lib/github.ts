import type { HostUser, LineComment, PullRequest } from "@collagen/review-web/data";

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
export const PULL_FIELDS = "number,url,title,state,isDraft,author,headRefOid,headRefName,baseRefName,reviewDecision";

const DECISION: Readonly<Record<string, string>> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

/** One pull request as `gh pr view --json PULL_FIELDS` has it, with the head
 *  and base branches it joins (for a stack). `viewer`: the login signed in. */
export const readPull = (v: unknown, viewer: string | undefined): (PullRequest & { readonly branch: string; readonly base: string }) | null => {
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
  };
};

/** The pull request a branch is: the open one, else the latest closed or
 *  merged — `gh pr list --head` lists newest first. */
export const pickPull = <P extends { readonly state: string }>(pulls: ReadonlyArray<P>): P | null => pulls.find((p) => p.state === "open") ?? pulls[0] ?? null;

/** `gh api --paginate --slurp repos/…/pulls/N/comments`: pages of comments,
 *  flattened. Comments GitHub no longer places on a line (outdated, the
 *  code under them moved) are left out — they have no line to sit under. */
export const readComments = (v: unknown): ReadonlyArray<LineComment> => {
  const items = Array.isArray(v) ? v.flatMap((page) => (Array.isArray(page) ? page : [page])) : [];
  return items.flatMap((c): ReadonlyArray<LineComment> => {
    const comment = readComment(c);
    return comment ? [comment] : [];
  });
};

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
    id,
    author,
    body: typeof o.body === "string" ? o.body : "",
    file,
    line,
    side: o.side === "LEFT" ? "LEFT" : "RIGHT",
    ...(startLine !== undefined && startLine !== line ? { startLine, startSide: o.start_side === "LEFT" ? ("LEFT" as const) : ("RIGHT" as const) } : {}),
    url: str(o.html_url) ?? "",
    at: str(o.created_at) ?? "",
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
