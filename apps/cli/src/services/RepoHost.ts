import { execFile } from "node:child_process";
import { repoWebUrl } from "../lib/gitInfo";
import { Data, Effect, Schema } from "effect";
import type { HostNote, HostReview, HostUser, HostWrite, LineComment, PullRequest, Verdict } from "@collagen/review-web/data";
import { defaultMergeMethod, githubRepo, MergesAnswer, mergesPage, MERGES_QUERY, type MergesPage, parse, pickPull, PULL_FIELDS, pullNumberIn, READINESS_FIELDS, readComment, readComments, readConversation, readOutdated, readPull, readReadiness, readReviews, readUser, refusal } from "../lib/github";
import type { HostReadiness } from "../lib/merging";

// Where a project's code is hosted, as something collagen can act on: read
// a compare diff when there is no clone, link back to it, and — for the
// review page — say who is signed in, find the pull request a review's
// branch is, read its line comments, and send a review or a comment in the
// reader's name. Host-agnostic by design; GitHub is the first, done through
// the person's own `gh` login, so collagen keeps no token of its own.

/** A pull request as a host has it, with the branches it joins. */
export type HostPull = PullRequest & {
  readonly branch: string;
  readonly base: string;
  readonly fork?: true;
  /** once merged: the commit it went into its base as */
  readonly merged?: string;
};

/** A pull request merged into a branch: how it landed — a merge commit, a
 *  squash, a rebase, or its head as it was (a fast-forward) — and the commit
 *  on the branch that it ended at. */
export interface HostMerge {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  /** the branch it was merged from */
  readonly branch: string;
  readonly kind: "merge" | "squash" | "rebase" | "fast-forward";
  /** the commit it landed as; of a rebase, the last of its commits */
  readonly commit: string;
  /** how many commits the pull request had */
  readonly commits: number;
  /** when it was merged */
  readonly at: string;
}

/** The host's CLI is not installed. */
export class HostCliMissing extends Data.TaggedError("HostCliMissing")<{}> {}

/** The host would not answer, or answered something else than asked: why, in its words. */
export class HostRefused extends Data.TaggedError("HostRefused")<{ readonly reason: string }> {}

/** Where on the pull request's diff a line comment goes: the file, its
 *  (last) line on one side, where a block of lines starts, at the commit the
 *  page shows. */
export interface LineSpot {
  readonly file: string;
  readonly line: number;
  readonly side: "LEFT" | "RIGHT";
  readonly start?: { readonly line: number; readonly side: "LEFT" | "RIGHT" };
  readonly commit: string;
}

/** A review as it is finished: a verdict, words (may be empty with an
 *  approval, or with comments), the commit it is of, and the comments held
 *  in it until now. */
export interface SubmittedReview {
  readonly verdict: Verdict;
  readonly body: string;
  readonly commit: string;
  readonly comments: ReadonlyArray<{ readonly body: string } & Omit<LineSpot, "commit">>;
}

/** Where code is hosted, as collagen speaks to it. Everything that differs
 *  from one host to the next — its tool, its API, its words, its refs — is
 *  behind this; the rest of collagen speaks only this (skill: repo-hosts).
 *  Another host is another implementation in HOSTS, nothing else. */
export interface RepoHost {
  /** short and stable: the namespace of its logins in an identity ("github:octocat") */
  readonly id: string;
  /** its name for people: "GitHub" */
  readonly name: string;
  readonly matches: (link: string) => boolean;
  /** base...branch as a diff, for a reader with no clone */
  readonly compare: (link: string, base: string, branch: string) => Effect.Effect<string | null>;
  /** a pull request's own diff, as the host keeps it — still there once it
   *  is merged and its branch is gone */
  readonly pullDiff: (link: string, pull: number) => Effect.Effect<string | null>;
  readonly links: (link: string, base: string | undefined, branch: string | undefined) => ReadonlyArray<{ readonly label: string; readonly url: string }>;
  /** who is signed in — or how to sign in; remembered a while, for reading */
  readonly viewer: Effect.Effect<{ readonly user: HostUser } | { readonly signIn: string }>;
  /** who is signed in this moment, asked again — what a write goes out
   *  under, whatever was remembered (and what is remembered from now on) */
  readonly viewerNow: Effect.Effect<{ readonly user: HostUser } | { readonly signIn: string }>;
  /** the pull request a review is: the one its link names, else its branch's */
  readonly pull: (link: string, branch: string | undefined) => Effect.Effect<{ readonly pull: HostPull } | { readonly none: string }>;
  /** the number of the pull request a link names (or a page of it), if it names one */
  readonly pullIn: (link: string) => number | null;
  /** its line comments: those on a line now, and those on code changed since */
  readonly comments: (link: string, pull: number) => Effect.Effect<{ readonly inline: ReadonlyArray<LineComment>; readonly outdated: ReadonlyArray<HostNote> }>;
  /** the reviews submitted on it */
  readonly reviews: (link: string, pull: number) => Effect.Effect<ReadonlyArray<HostReview>>;
  /** its conversation: comments on the whole, not a line */
  readonly conversation: (link: string, pull: number) => Effect.Effect<ReadonlyArray<HostNote>>;
  /** the repository's open pull requests, for the stack a branch sits in */
  readonly openPulls: (link: string) => Effect.Effect<ReadonlyArray<HostPull>>;
  /** one page of the pull requests merged into `base`, whatever kind of
   *  merge each was: the first, or the one after `after` */
  readonly mergesPage: (link: string, base: string, after: string | null) => Effect.Effect<MergesPage, HostCliMissing | HostRefused>;
  /** a whole review, at once: its verdict, its words, and every comment
   *  held in it — GitHub's "Finish your review" */
  readonly submit: (link: string, pull: number, review: SubmittedReview) => Effect.Effect<{ readonly ok: true; readonly url: string; readonly comments: ReadonlyArray<LineComment> } | { readonly error: string }>;
  readonly comment: (link: string, pull: number, at: LineSpot, body: string) => Effect.Effect<HostWrite>;
  /** whether a pull request can be merged now, as the host sees it: its
   *  state, checks, conflicts and its own rules' approvals */
  readonly readiness: (link: string, pull: number) => Effect.Effect<{ readonly pull: HostReadiness } | { readonly none: string }>;
  /** merge it as the person signed in, the repository's default way — never
   *  past the host's own rules */
  readonly merge: (link: string, pull: number) => Effect.Effect<{ readonly ok: true } | { readonly error: string }>;
  /** where the host keeps a pull request's head in the repository itself —
   *  how a clone reads one opened from a fork */
  readonly pullRef: (pull: number) => string;
  /** a branch's page, from the repository's web address */
  readonly branchUrl: (repo: string, branch: string) => string;
}

interface Ran {
  readonly ok: boolean;
  readonly out: string;
  readonly error: string;
  /** the command is not installed */
  readonly missing: boolean;
}

/** The GitHub CLI — COLLAGEN_GH stands another in (the e2e scenarios' fake,
 *  which must never reach GitHub). */
const ghCommand = (): string => process.env.COLLAGEN_GH ?? "gh";

/** Run gh: what it printed, and whether it did what was asked. Never a
 *  failure — no gh, no network and no login all read as words on the page.
 *  `input` goes to its stdin (a request body for `gh api --input -`). */
const runGh = (args: ReadonlyArray<string>, timeoutMs = 20_000, input?: string): Effect.Effect<Ran> =>
  Effect.callback<Ran>((resume) => {
    const child = execFile(ghCommand(), [...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (error, stdout, stderr) =>
      resume(Effect.succeed({ ok: !error, out: stdout ?? "", error: stderr ?? (error ? String(error) : ""), missing: (error as NodeJS.ErrnoException | null)?.code === "ENOENT" })),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
    return Effect.sync(() => child.kill());
  });

const NO_GH = "Install the GitHub CLI (gh) and run gh auth login to act on the pull request from here.";

/** Who is signed in does not change while a page is read; asked again after a while, and after a failure at once. */
const VIEWER_FOR_MS = 10 * 60_000;
let viewerSeen: { readonly at: number; readonly user: HostUser } | null = null;

/** Ask gh who is signed in, and remember it (a failure is not remembered —
 *  and forgets what was). */
type Viewer = { readonly user: HostUser } | { readonly signIn: string };
const askViewer: Effect.Effect<Viewer> = Effect.gen(function* () {
  const ran = yield* runGh(["api", "user"], 10_000);
  if (ran.missing) return { signIn: NO_GH };
  const user = ran.ok ? readUser(parse(ran.out)) : null;
  if (!user) {
    viewerSeen = null;
    return { signIn: `Not signed in to GitHub (${refusal(ran.error)}): run gh auth login.` };
  }
  viewerSeen = { at: Date.now(), user };
  return { user };
});

/** GitHub, through the person's own `gh` login. */
export const github: RepoHost = {
  id: "github",
  name: "GitHub",
  pullRef: (pull) => `refs/pull/${pull}/head`,
  branchUrl: (repo, branch) => `${repo}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`,
  matches: (link) => githubRepo(link) !== null,
  pullIn: pullNumberIn,
  compare: (link, base, branch) => {
    const repository = githubRepo(link);
    if (!repository) return Effect.succeed(null);
    return runGh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repository.owner}/${repository.repo}/compare/${base}...${branch}`]).pipe(Effect.map((ran) => (ran.ok ? ran.out : null)));
  },
  pullDiff: (link, pull) => {
    const repository = githubRepo(link);
    if (!repository) return Effect.succeed(null);
    return runGh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repository.owner}/${repository.repo}/pulls/${pull}`]).pipe(Effect.map((ran) => (ran.ok ? ran.out : null)));
  },
  links: (link, base, branch) => {
    const repository = githubRepo(link);
    if (!repository) return [];
    const isPull = /\/pull\/\d+/.test(link);
    return [
      { label: isPull ? "pull request" : "on GitHub", url: link },
      ...(isPull ? [{ label: "checks", url: `${link.replace(/\/(files|commits|checks)\/?$/, "")}/checks` }] : []),
      ...(base && branch ? [{ label: "compare", url: `https://github.com/${repository.owner}/${repository.repo}/compare/${base}...${branch}` }] : []),
    ];
  },
  viewer: Effect.suspend((): Effect.Effect<Viewer> => (viewerSeen && Date.now() - viewerSeen.at < VIEWER_FOR_MS ? Effect.succeed({ user: viewerSeen.user }) : askViewer)),
  viewerNow: Effect.suspend(() => askViewer),
  pull: (link, branch) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const repo = `${repository.owner}/${repository.repo}`;
      const named = pullNumberIn(link);
      if (named !== null) {
        const ran = yield* runGh(["pr", "view", String(named), "--repo", repo, "--json", PULL_FIELDS]);
        if (ran.missing) return { none: NO_GH };
        const pull = ran.ok ? readPull(parse(ran.out), undefined) : null;
        return pull ? { pull } : { none: `Could not read pull request #${named}: ${refusal(ran.error)}` };
      }
      if (!branch) return { none: "This review names no branch to find its pull request by." };
      const ran = yield* runGh(["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", PULL_FIELDS, "--limit", "10"]);
      if (ran.missing) return { none: NO_GH };
      if (!ran.ok) return { none: `Could not look for a pull request: ${refusal(ran.error)}` };
      const list = parse(ran.out);
      const pulls = (Array.isArray(list) ? list : []).flatMap((item) => readPull(item, undefined) ?? []);
      const pull = pickPull(pulls);
      return pull ? { pull } : { none: `No pull request for ${branch} yet.` };
    }),
  comments: (link, pull) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const ran = yield* runGh(["api", "--paginate", "--slurp", `repos/${repository.owner}/${repository.repo}/pulls/${pull}/comments`]);
      const got = ran.ok ? parse(ran.out) : null;
      return { inline: readComments(got), outdated: readOutdated(got) };
    }),
  reviews: (link, pull) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const ran = yield* runGh(["api", "--paginate", "--slurp", `repos/${repository.owner}/${repository.repo}/pulls/${pull}/reviews`]);
      return ran.ok ? readReviews(parse(ran.out)) : [];
    }),
  conversation: (link, pull) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const ran = yield* runGh(["api", "--paginate", "--slurp", `repos/${repository.owner}/${repository.repo}/issues/${pull}/comments`]);
      return ran.ok ? readConversation(parse(ran.out)) : [];
    }),
  openPulls: (link) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const ran = yield* runGh(["pr", "list", "--repo", `${repository.owner}/${repository.repo}`, "--state", "open", "--json", PULL_FIELDS, "--limit", "200"]);
      const list = ran.ok ? parse(ran.out) : null;
      return (Array.isArray(list) ? list : []).flatMap((item) => readPull(item, undefined) ?? []);
    }),
  mergesPage: (link, base, after) => {
    const repository = githubRepo(link)!;
    return runGh(["api", "graphql", "-f", `owner=${repository.owner}`, "-f", `repo=${repository.repo}`, "-f", `base=${base}`, ...(after ? ["-f", `after=${after}`] : []), "-f", `query=${MERGES_QUERY}`]).pipe(
      Effect.flatMap((ran): Effect.Effect<typeof MergesAnswer.Type, HostCliMissing | HostRefused> =>
        ran.missing
          ? Effect.fail(new HostCliMissing())
          : !ran.ok
            ? Effect.fail(new HostRefused({ reason: refusal(ran.error) }))
            : Schema.decodeUnknownEffect(MergesAnswer)(ran.out).pipe(Effect.mapError(() => new HostRefused({ reason: "gh answered something else than asked" }))),
      ),
      Effect.map(mergesPage),
    );
  },
  submit: (link, pull, review) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const repo = `repos/${repository.owner}/${repository.repo}/pulls/${pull}`;
      const event = review.verdict === "approve" ? "APPROVE" : review.verdict === "request-changes" ? "REQUEST_CHANGES" : "COMMENT";
      const payload = {
        commit_id: review.commit,
        event,
        ...(review.body.length > 0 ? { body: review.body } : {}),
        comments: review.comments.map((comment) => ({ path: comment.file, line: comment.line, side: comment.side, body: comment.body, ...(comment.start ? { start_line: comment.start.line, start_side: comment.start.side } : {}) })),
      };
      const ran = yield* runGh(["api", "-X", "POST", `${repo}/reviews`, "--input", "-"], 30_000, JSON.stringify(payload));
      if (ran.missing) return { error: NO_GH };
      if (!ran.ok) return { error: refusal(ran.error) };
      const made = parse(ran.out) as { id?: unknown; html_url?: unknown } | null;
      const id = typeof made?.id === "number" ? made.id : null;
      const url = typeof made?.html_url === "string" ? made.html_url : "";
      // its comments as GitHub placed them — their ids, to show each once
      const listed = id !== null && review.comments.length > 0 ? yield* runGh(["api", "--paginate", "--slurp", `${repo}/reviews/${id}/comments`]) : null;
      return { ok: true as const, url, comments: listed?.ok ? readComments(parse(listed.out)) : [] };
    }),
  readiness: (link, pull) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const ran = yield* runGh(["pr", "view", String(pull), "--repo", `${repository.owner}/${repository.repo}`, "--json", READINESS_FIELDS]);
      if (ran.missing) return { none: NO_GH };
      const read = ran.ok ? readReadiness(parse(ran.out)) : null;
      return read ? { pull: read } : { none: `Could not read pull request #${pull}: ${refusal(ran.error)}` };
    }),
  merge: (link, pull) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      const repo = `${repository.owner}/${repository.repo}`;
      const allowed = yield* runGh(["repo", "view", repo, "--json", "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"]);
      if (allowed.missing) return { error: NO_GH };
      const method = allowed.ok ? defaultMergeMethod(parse(allowed.out)) : null;
      if (method === null) return { error: `Could not tell how ${repo} merges: ${refusal(allowed.error)}` };
      // as the person, by the repository's rules: never --admin
      const ran = yield* runGh(["pr", "merge", String(pull), "--repo", repo, `--${method}`], 60_000);
      if (ran.missing) return { error: NO_GH };
      return ran.ok ? { ok: true as const } : { error: refusal(ran.error) };
    }),
  comment: (link, pull, at, body) =>
    Effect.gen(function* () {
      const repository = githubRepo(link)!;
      // -f sends each as a plain string (never read from a file, as -F's @ would); the line is a number
      const ran = yield* runGh(["api", "-X", "POST", `repos/${repository.owner}/${repository.repo}/pulls/${pull}/comments`, "-f", `body=${body}`, "-f", `commit_id=${at.commit}`, "-f", `path=${at.file}`, "-F", `line=${at.line}`, "-f", `side=${at.side}`, ...(at.start ? ["-F", `start_line=${at.start.line}`, "-f", `start_side=${at.start.side}`] : [])]);
      if (ran.missing) return { error: NO_GH };
      if (!ran.ok) return { error: refusal(ran.error) };
      const comment = readComment(parse(ran.out));
      return comment ? { ok: true as const, comment } : { ok: true as const };
    }),
};

export const HOSTS: ReadonlyArray<RepoHost> = [github];

/** The host a link is on, if collagen has an integration for it. */
export const hostOf = (link: string): RepoHost | undefined => HOSTS.find((host) => host.matches(link));
/** A link the reviewer can open for a branch of the clone at `root` — the
 *  fallback when the agent has no pull request to give: the branch's page on
 *  its host, or, on a host collagen does not know, the repository itself. */
export const branchLink = (root: string, branch: string): string | null => {
  const repo = repoWebUrl(root);
  if (!repo) return null;
  return hostOf(repo)?.branchUrl(repo, branch) ?? repo;
};

/** A host by its id — what an identity names. */
export const hostById = (id: string): RepoHost | undefined => HOSTS.find((host) => host.id === id);
