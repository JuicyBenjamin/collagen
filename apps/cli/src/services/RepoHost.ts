import { execFile } from "node:child_process";
import { Effect } from "effect";
import type { HostUser, HostWrite, LineComment, PullRequest, Verdict } from "@collagen/review-web/data";
import { githubRepo, parse, pickPull, PULL_FIELDS, pullNumberIn, readComment, readComments, readPull, readUser, refusal } from "../lib/github";

// Where a project's code is hosted, as something collagen can act on: read
// a compare diff when there is no clone, link back to it, and — for the
// review page — say who is signed in, find the pull request a review's
// branch is, read its line comments, and send a review or a comment in the
// reader's name. Host-agnostic by design; GitHub is the first, done through
// the person's own `gh` login, so collagen keeps no token of its own.

/** A pull request as a host has it, with the branches it joins. */
export type HostPull = PullRequest & { readonly branch: string; readonly base: string };

/** Where on the pull request's diff a line comment goes: the file, its line
 *  on one side, at the commit the page shows. */
export interface LineSpot {
  readonly file: string;
  readonly line: number;
  readonly side: "LEFT" | "RIGHT";
  readonly commit: string;
}

export interface RepoHost {
  readonly name: string;
  readonly matches: (link: string) => boolean;
  /** base...branch as a diff, for a reader with no clone */
  readonly compare: (link: string, base: string, branch: string) => Effect.Effect<string | null>;
  readonly links: (link: string, base: string | undefined, branch: string | undefined) => ReadonlyArray<{ readonly label: string; readonly url: string }>;
  /** who is signed in — or how to sign in */
  readonly viewer: Effect.Effect<{ readonly user: HostUser } | { readonly signIn: string }>;
  /** the pull request a review is: the one its link names, else its branch's */
  readonly pull: (link: string, branch: string | undefined) => Effect.Effect<{ readonly pull: HostPull } | { readonly none: string }>;
  readonly comments: (link: string, pull: number) => Effect.Effect<ReadonlyArray<LineComment>>;
  /** the repository's open pull requests, for the stack a branch sits in */
  readonly openPulls: (link: string) => Effect.Effect<ReadonlyArray<HostPull>>;
  readonly review: (link: string, pull: number, verdict: Verdict, body: string) => Effect.Effect<HostWrite>;
  readonly comment: (link: string, pull: number, at: LineSpot, body: string) => Effect.Effect<HostWrite>;
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
 *  failure — no gh, no network and no login all read as words on the page. */
const gh = (args: ReadonlyArray<string>, timeoutMs = 20_000): Effect.Effect<Ran> =>
  Effect.callback<Ran>((resume) => {
    const child = execFile(ghCommand(), [...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (err, stdout, stderr) =>
      resume(Effect.succeed({ ok: !err, out: stdout ?? "", err: stderr ?? (err ? String(err) : ""), missing: (err as NodeJS.ErrnoException | null)?.code === "ENOENT" })),
    );
    return Effect.sync(() => child.kill());
  });

const NO_GH = "Install the GitHub CLI (gh) and run gh auth login to act on the pull request from here.";

/** Who is signed in does not change while a page is read; asked again after a while, and after a failure at once. */
const VIEWER_FOR_MS = 10 * 60_000;
let viewerSeen: { readonly at: number; readonly user: HostUser } | null = null;

/** GitHub, through the person's own `gh` login. */
export const github: RepoHost = {
  name: "GitHub",
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
  viewer: Effect.gen(function* () {
    if (viewerSeen && Date.now() - viewerSeen.at < VIEWER_FOR_MS) return { user: viewerSeen.user };
    const ran = yield* gh(["api", "user"], 10_000);
    if (ran.missing) return { signIn: NO_GH };
    const user = ran.ok ? readUser(parse(ran.out)) : null;
    if (!user) return { signIn: `Not signed in to GitHub (${refusal(ran.err)}): run gh auth login.` };
    viewerSeen = { at: Date.now(), user };
    return { user };
  }),
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
      return ran.ok ? readComments(parse(ran.out)) : [];
    }),
  openPulls: (link) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const ran = yield* gh(["pr", "list", "--repo", `${r.owner}/${r.repo}`, "--state", "open", "--json", PULL_FIELDS, "--limit", "200"]);
      const list = ran.ok ? parse(ran.out) : null;
      return (Array.isArray(list) ? list : []).flatMap((p) => readPull(p, undefined) ?? []);
    }),
  review: (link, pull, verdict, body) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      const flag = verdict === "approve" ? "--approve" : verdict === "request-changes" ? "--request-changes" : "--comment";
      const ran = yield* gh(["pr", "review", String(pull), "--repo", `${r.owner}/${r.repo}`, flag, ...(body.length > 0 ? ["--body", body] : [])]);
      if (ran.missing) return { error: NO_GH };
      return ran.ok ? { ok: true as const } : { error: refusal(ran.err) };
    }),
  comment: (link, pull, at, body) =>
    Effect.gen(function* () {
      const r = githubRepo(link)!;
      // -f sends each as a plain string (never read from a file, as -F's @ would); the line is a number
      const ran = yield* gh(["api", "-X", "POST", `repos/${r.owner}/${r.repo}/pulls/${pull}/comments`, "-f", `body=${body}`, "-f", `commit_id=${at.commit}`, "-f", `path=${at.file}`, "-F", `line=${at.line}`, "-f", `side=${at.side}`]);
      if (ran.missing) return { error: NO_GH };
      if (!ran.ok) return { error: refusal(ran.err) };
      const comment = readComment(parse(ran.out));
      return comment ? { ok: true as const, comment } : { ok: true as const };
    }),
};

export const HOSTS: ReadonlyArray<RepoHost> = [github];

/** The host a link is on, if collagen has an integration for it. */
export const hostOf = (link: string): RepoHost | undefined => HOSTS.find((h) => h.matches(link));
