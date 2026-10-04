import { execFile } from "node:child_process";
import { repoWebUrl } from "../lib/gitInfo";
import { Effect } from "effect";
import type { HostNote, HostReview, HostUser, HostWrite, LineComment, PullRequest, Verdict } from "@collagen/review-web/data";
import { githubRepo, parse, pickPull, PULL_FIELDS, pullNumberIn, readComment, readComments, readConversation, readOutdated, readPull, readReviews, readUser, refusal } from "../lib/github";

// Where a project's code is hosted, as something collagen can act on: read
// a compare diff when there is no clone, link back to it, and — for the
// review page — say who is signed in, find the pull request a review's
// branch is, read its line comments, and send a review or a comment in the
// reader's name. Host-agnostic by design; GitHub is the first, done through
// the person's own `gh` login, so collagen keeps no token of its own.

/** A pull request as a host has it, with the branches it joins. */
export type HostPull = PullRequest & { readonly branch: string; readonly base: string; readonly fork?: true };

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
  readonly links: (link: string, base: string | undefined, branch: string | undefined) => ReadonlyArray<{ readonly label: string; readonly url: string }>;
  /** who is signed in — or how to sign in; remembered a while, for reading */
  readonly viewer: Effect.Effect<{ readonly user: HostUser } | { readonly signIn: string }>;
  /** who is signed in this moment, asked again — what a write goes out
   *  under, whatever was remembered (and what is remembered from now on) */
  readonly viewerNow: Effect.Effect<{ readonly user: HostUser } | { readonly signIn: string }>;
  /** the pull request a review is: the one its link names, else its branch's */
  readonly pull: (link: string, branch: string | undefined) => Effect.Effect<{ readonly pull: HostPull } | { readonly none: string }>;
  /** its line comments: those on a line now, and those on code changed since */
  readonly comments: (link: string, pull: number) => Effect.Effect<{ readonly inline: ReadonlyArray<LineComment>; readonly outdated: ReadonlyArray<HostNote> }>;
  /** the reviews submitted on it */
  readonly reviews: (link: string, pull: number) => Effect.Effect<ReadonlyArray<HostReview>>;
  /** its conversation: comments on the whole, not a line */
  readonly conversation: (link: string, pull: number) => Effect.Effect<ReadonlyArray<HostNote>>;
  /** the repository's open pull requests, for the stack a branch sits in */
  readonly openPulls: (link: string) => Effect.Effect<ReadonlyArray<HostPull>>;
  /** a whole review, at once: its verdict, its words, and every comment
   *  held in it — GitHub's "Finish your review" */
  readonly submit: (link: string, pull: number, review: SubmittedReview) => Effect.Effect<{ readonly ok: true; readonly url: string; readonly comments: ReadonlyArray<LineComment> } | { readonly error: string }>;
  readonly comment: (link: string, pull: number, at: LineSpot, body: string) => Effect.Effect<HostWrite>;
  /** where the host keeps a pull request's head in the repository itself —
   *  how a clone reads one opened from a fork */
  readonly pullRef: (pull: number) => string;
  /** a branch's page, from the repository's web address */
  readonly branchUrl: (repo: string, branch: string) => string;
}

interface Ran {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
  /** the command is not installed */
  readonly missing: boolean;
}

/** The GitHub CLI — COLLAGEN_GH stands another in (the e2e scenarios' fake,
 *  which must never reach GitHub). */
const ghCommand = (): string => process.env.COLLAGEN_GH ?? "gh";

/** Run gh: what it printed, and whether it did what was asked. Never a
 *  failure — no gh, no network and no login all read as words on the page.
 *  `input` goes to its stdin (a request body for `gh api --input -`). */
const gh = (args: ReadonlyArray<string>, timeoutMs = 20_000, input?: string): Effect.Effect<Ran> =>
  Effect.callback<Ran>((resume) => {
    const child = execFile(ghCommand(), [...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (err, stdout, stderr) =>
      resume(Effect.succeed({ ok: !err, out: stdout ?? "", err: stderr ?? (err ? String(err) : ""), missing: (err as NodeJS.ErrnoException | null)?.code === "ENOENT" })),
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
  const ran = yield* gh(["api", "user"], 10_000);
  if (ran.missing) return { signIn: NO_GH };
  const user = ran.ok ? readUser(parse(ran.out)) : null;
  if (!user) {
    viewerSeen = null;
    return { signIn: `Not signed in to GitHub (${refusal(ran.err)}): run gh auth login.` };
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
  compare: (link, base, branch) => {
    const r = githubRepo(link);
    if (!r) return Effect.succeed(null);
    return gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${r.owner}/${r.repo}/compare/${base}...${branch}`]).pipe(Effect.map((ran) => (ran.ok ? ran.out : null)));
  },
  links: (link, base, branch) => {
    const r = githubRepo(link);
    if (!r) return [];
    const pr = /\/pull\/\d+/.test(link);
    return [
      { label: pr ? "pull request" : "on GitHub", url: link },
      ...(pr ? [{ label: "checks", url: `${link.replace(/\/(files|commits|checks)\/?$/, "")}/checks` }] : []),
      ...(base && branch ? [{ label: "compare", url: `https://github.com/${r.owner}/${r.repo}/compare/${base}...${branch}` }] : []),
    ];
  },
  viewer: Effect.suspend((): Effect.Effect<Viewer> => (viewerSeen && Date.now() - viewerSeen.at < VIEWER_FOR_MS ? Effect.succeed({ user: viewerSeen.user }) : askViewer)),
  viewerNow: Effect.suspend(() => askViewer),
  pull: (link, branch) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const repo = `${r.owner}/${r.repo}`;
      const named = pullNumberIn(link);
      if (named !== null) {
        const ran = yield* gh(["pr", "view", String(named), "--repo", repo, "--json", PULL_FIELDS]);
        if (ran.missing) return { none: NO_GH };
        const pull = ran.ok ? readPull(parse(ran.out), undefined) : null;
        return pull ? { pull } : { none: `Could not read pull request #${named}: ${refusal(ran.err)}` };
      }
      if (!branch) return { none: "This review names no branch to find its pull request by." };
      const ran = yield* gh(["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", PULL_FIELDS, "--limit", "10"]);
      if (ran.missing) return { none: NO_GH };
      if (!ran.ok) return { none: `Could not look for a pull request: ${refusal(ran.err)}` };
      const list = parse(ran.out);
      const pulls = (Array.isArray(list) ? list : []).flatMap((p) => readPull(p, undefined) ?? []);
      const pull = pickPull(pulls);
      return pull ? { pull } : { none: `No pull request for ${branch} yet.` };
    }),
  comments: (link, pull) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const ran = yield* gh(["api", "--paginate", "--slurp", `repos/${r.owner}/${r.repo}/pulls/${pull}/comments`]);
      const got = ran.ok ? parse(ran.out) : null;
      return { inline: readComments(got), outdated: readOutdated(got) };
    }),
  reviews: (link, pull) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const ran = yield* gh(["api", "--paginate", "--slurp", `repos/${r.owner}/${r.repo}/pulls/${pull}/reviews`]);
      return ran.ok ? readReviews(parse(ran.out)) : [];
    }),
  conversation: (link, pull) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const ran = yield* gh(["api", "--paginate", "--slurp", `repos/${r.owner}/${r.repo}/issues/${pull}/comments`]);
      return ran.ok ? readConversation(parse(ran.out)) : [];
    }),
  openPulls: (link) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const ran = yield* gh(["pr", "list", "--repo", `${r.owner}/${r.repo}`, "--state", "open", "--json", PULL_FIELDS, "--limit", "200"]);
      const list = ran.ok ? parse(ran.out) : null;
      return (Array.isArray(list) ? list : []).flatMap((p) => readPull(p, undefined) ?? []);
    }),
  submit: (link, pull, review) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const repo = `repos/${r.owner}/${r.repo}/pulls/${pull}`;
      const event = review.verdict === "approve" ? "APPROVE" : review.verdict === "request-changes" ? "REQUEST_CHANGES" : "COMMENT";
      const payload = {
        commit_id: review.commit,
        event,
        ...(review.body.length > 0 ? { body: review.body } : {}),
        comments: review.comments.map((c) => ({ path: c.file, line: c.line, side: c.side, body: c.body, ...(c.start ? { start_line: c.start.line, start_side: c.start.side } : {}) })),
      };
      const ran = yield* gh(["api", "-X", "POST", `${repo}/reviews`, "--input", "-"], 30_000, JSON.stringify(payload));
      if (ran.missing) return { error: NO_GH };
      if (!ran.ok) return { error: refusal(ran.err) };
      const made = parse(ran.out) as { id?: unknown; html_url?: unknown } | null;
      const id = typeof made?.id === "number" ? made.id : null;
      const url = typeof made?.html_url === "string" ? made.html_url : "";
      // its comments as GitHub placed them — their ids, to show each once
      const listed = id !== null && review.comments.length > 0 ? yield* gh(["api", "--paginate", "--slurp", `${repo}/reviews/${id}/comments`]) : null;
      return { ok: true as const, url, comments: listed?.ok ? readComments(parse(listed.out)) : [] };
    }),
  comment: (link, pull, at, body) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      // -f sends each as a plain string (never read from a file, as -F's @ would); the line is a number
      const ran = yield* gh(["api", "-X", "POST", `repos/${r.owner}/${r.repo}/pulls/${pull}/comments`, "-f", `body=${body}`, "-f", `commit_id=${at.commit}`, "-f", `path=${at.file}`, "-F", `line=${at.line}`, "-f", `side=${at.side}`, ...(at.start ? ["-F", `start_line=${at.start.line}`, "-f", `start_side=${at.start.side}`] : [])]);
      if (ran.missing) return { error: NO_GH };
      if (!ran.ok) return { error: refusal(ran.err) };
      const comment = readComment(parse(ran.out));
      return comment ? { ok: true as const, comment } : { ok: true as const };
    }),
};

export const HOSTS: ReadonlyArray<RepoHost> = [github];

/** The host a link is on, if collagen has an integration for it. */
export const hostOf = (link: string): RepoHost | undefined => HOSTS.find((h) => h.matches(link));
/** A link the reviewer can open for a branch of the clone at `root` — the
 *  fallback when the agent has no pull request to give: the branch's page on
 *  its host, or, on a host collagen does not know, the repository itself. */
export const branchLink = (root: string, branch: string): string | null => {
  const repo = repoWebUrl(root);
  if (!repo) return null;
  return hostOf(repo)?.branchUrl(repo, branch) ?? repo;
};

/** A host by its id — what an identity names. */
export const hostById = (id: string): RepoHost | undefined => HOSTS.find((h) => h.id === id);
