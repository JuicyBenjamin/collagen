import { repoWebUrl } from "../lib/gitInfo";
import { Config, Data, Effect, Option, Schema, Stream, type Duration } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { HostNote, HostReview, HostUser, LineComment, PullRequest, Verdict } from "@collagen/review-web/data";
import { CreatedReview, githubRepo, IssueComment, latestMerges, MergesAnswer, mergesPage, MERGES_QUERY, type MergesPage, Pages, pickPull, Pull, PULL_FIELDS, PullComment, pullNumberIn, refusal, Review, splitComments, toLineComment, toNote, toPull, toReview, toUser, User } from "../lib/github";

// Where a project's code is hosted, as something collagen can act on: read
// a compare diff when there is no clone, link back to it, and — for the
// review page — say who is signed in, find the pull request a review's
// branch is, read its line comments, and send a review or a comment in the
// reader's name. Host-agnostic by design; GitHub is the first, done through
// the person's own `gh` login, so collagen keeps no token of its own.

/** A pull request as a host has it, with the branches it joins. */
export type HostPull = Omit<PullRequest, "mine"> & {
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

/** The host's CLI is not installed: how to get it, in the host's words. */
export class HostCliMissing extends Data.TaggedError("HostCliMissing")<{ readonly message: string }> {}

/** The host would not do what was asked, or answered something else: why,
 *  in its words. */
export class HostRefused extends Data.TaggedError("HostRefused")<{ readonly message: string }> {}

/** No pull request to act on: why. */
export class NoPull extends Data.TaggedError("NoPull")<{ readonly message: string }> {}

/** Asking the host anything: its CLI runs as a child process, and may be
 *  missing or refuse. */
type Asked<A, E = HostCliMissing | HostRefused> = Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>;

/** Where code is hosted, as collagen speaks to it. Everything that differs
 *  from one host to the next — its tool, its API, its words, its refs — is
 *  behind this; the rest of collagen speaks only this (skill: repo-hosts).
 *  Another host is another implementation in HOSTS, nothing else. A failure
 *  is an error with the words to show for it (`message`); the page and the
 *  agents decide where to show them. */
export interface RepoHost {
  /** short and stable: the namespace of its logins in an identity ("github:octocat") */
  readonly id: string;
  /** its name for people: "GitHub" */
  readonly name: string;
  readonly matches: (link: string) => boolean;
  /** base...branch as a diff, for a reader with no clone */
  readonly compare: (link: string, base: string, branch: string) => Asked<string>;
  /** a pull request's own diff, as the host keeps it — still there once it
   *  is merged and its branch is gone */
  readonly pullDiff: (link: string, pull: number) => Asked<string>;
  readonly links: (link: string, base: string | undefined, branch: string | undefined) => ReadonlyArray<{ readonly label: string; readonly url: string }>;
  /** who is signed in — refused with how to sign in; remembered a while, for reading */
  readonly viewer: Asked<HostUser>;
  /** who is signed in this moment, asked again — what a write goes out
   *  under, whatever was remembered (and what is remembered from now on) */
  readonly viewerNow: Asked<HostUser>;
  /** the pull request a review is: the one its link names, else its branch's */
  readonly pull: (link: string, branch: string | undefined) => Asked<HostPull, HostCliMissing | HostRefused | NoPull>;
  /** the number of the pull request a link names (or a page of it), if it names one */
  readonly pullIn: (link: string) => number | null;
  /** its line comments: those on a line now, and those on code changed since */
  readonly comments: (link: string, pull: number) => Asked<{ readonly inline: ReadonlyArray<LineComment>; readonly outdated: ReadonlyArray<HostNote> }>;
  /** the reviews submitted on it */
  readonly reviews: (link: string, pull: number) => Asked<ReadonlyArray<HostReview>>;
  /** its conversation: comments on the whole, not a line */
  readonly conversation: (link: string, pull: number) => Asked<ReadonlyArray<HostNote>>;
  /** the repository's open pull requests, for the stack a branch sits in */
  readonly openPulls: (link: string) => Asked<ReadonlyArray<HostPull>>;
  /** the pull requests merged into `base`, the latest first, at most
   *  `limit` — whatever kind of merge each was */
  readonly merges: (link: string, base: string, limit?: number) => Asked<ReadonlyArray<HostMerge>>;
  /** a whole review, at once: its verdict, its words, and every comment
   *  held in it — GitHub's "Finish your review". Where it is, and its
   *  comments as the host placed them, when the host says. */
  readonly submit: (link: string, pull: number, review: SubmittedReview) => Asked<{ readonly url: Option.Option<string>; readonly comments: ReadonlyArray<LineComment> }>;
  /** one comment, at once; as the host placed it, when it says */
  readonly comment: (link: string, pull: number, at: LineSpot, body: string) => Asked<Option.Option<LineComment>>;
  /** where the host keeps a pull request's head in the repository itself —
   *  how a clone reads one opened from a fork */
  readonly pullRef: (pull: number) => string;
  /** a branch's page, from the repository's web address */
  readonly branchUrl: (repo: string, branch: string) => string;
}

/** The GitHub CLI — COLLAGEN_GH stands another in (the e2e scenarios' fake,
 *  which must never reach GitHub). */
const ghCommand = Config.String("COLLAGEN_GH").pipe(Config.withDefault("gh"));

const noGh = () => new HostCliMissing({ message: "Install the GitHub CLI (gh) and run gh auth login to act on the pull request from here." });

/** Run gh: what it printed — or, when it did not do what was asked, why.
 *  `input` goes to its stdin (a request body for `gh api --input -`). */
const gh = (args: ReadonlyArray<string>, options: { readonly timeout?: Duration.Input; readonly input?: string } = {}): Asked<string> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(yield* Effect.orDie(ghCommand), args, {
        env: { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
        extendEnv: true,
        stdin: options.input === undefined ? "ignore" : Stream.encodeText(Stream.make(options.input)),
      }),
    );
    const [out, err, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode], { concurrency: "unbounded" });
    if (code !== 0) return yield* new HostRefused({ message: refusal(err) });
    return out;
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({ duration: options.timeout ?? "20 seconds", orElse: () => Effect.fail(new HostRefused({ message: "GitHub did not answer in time" })) }),
    Effect.catchTag("PlatformError", (e) => Effect.fail(e.reason._tag === "NotFound" ? noGh() : new HostRefused({ message: e.message }))),
  );

/** gh's answer, as the schema asked for — or refused, when it is something else. */
const decoded =
  <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  (text: string): Effect.Effect<S["Type"], HostRefused> =>
    Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(
      Effect.tapError((e) => Effect.logWarning(`gh answered something else than asked: ${e.message}`)),
      Effect.mapError(() => new HostRefused({ message: "gh answered something else than asked" })),
    );

/** Ask gh, and read its answer as the schema says. */
const ghRead = <S extends Schema.Codec<unknown, unknown>>(schema: S, args: ReadonlyArray<string>, options?: { readonly timeout?: Duration.Input }) => gh(args, options).pipe(Effect.flatMap(decoded(schema)));

/** The repository a link `matches` said is GitHub's. */
const repoOf = (link: string): string => {
  const r = githubRepo(link)!;
  return `${r.owner}/${r.repo}`;
};

/** At most this many pages (of 100 pull requests) are read for `merges`. */
const MERGES_MAX_PAGES = 10;

/** Who is signed in does not change while a page is read; asked again after a while, and after a failure at once. */
const VIEWER_FOR_MS = 10 * 60_000;
let viewerSeen: { readonly at: number; readonly user: HostUser } | null = null;

/** Ask gh who is signed in, and remember it (a failure is not remembered —
 *  and forgets what was). */
const askViewer: Asked<HostUser> = ghRead(User, ["api", "user"], { timeout: "10 seconds" }).pipe(
  Effect.map(toUser),
  Effect.tap((user) => Effect.sync(() => void (viewerSeen = { at: Date.now(), user }))),
  Effect.tapError(() => Effect.sync(() => void (viewerSeen = null))),
  Effect.catchTag("HostRefused", (e) => Effect.fail(new HostRefused({ message: `Not signed in to GitHub (${e.message}): run gh auth login.` }))),
);

/** GitHub, through the person's own `gh` login. */
export const github: RepoHost = {
  id: "github",
  name: "GitHub",
  pullRef: (pull) => `refs/pull/${pull}/head`,
  branchUrl: (repo, branch) => `${repo}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`,
  matches: (link) => githubRepo(link) !== null,
  pullIn: pullNumberIn,
  compare: (link, base, branch) => gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repoOf(link)}/compare/${base}...${branch}`]),
  pullDiff: (link, pull) => gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repoOf(link)}/pulls/${pull}`]),
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
  viewer: Effect.suspend(() => (viewerSeen && Date.now() - viewerSeen.at < VIEWER_FOR_MS ? Effect.succeed(viewerSeen.user) : askViewer)),
  viewerNow: Effect.suspend(() => askViewer),
  pull: (link, branch) => {
    const repo = repoOf(link);
    const named = pullNumberIn(link);
    if (named !== null)
      return ghRead(Pull, ["pr", "view", String(named), "--repo", repo, "--json", PULL_FIELDS]).pipe(
        Effect.map(toPull),
        Effect.catchTag("HostRefused", (e) => Effect.fail(new HostRefused({ message: `Could not read pull request #${named}: ${e.message}` }))),
      );
    if (!branch) return Effect.fail(new NoPull({ message: "This review names no branch to find its pull request by." }));
    return ghRead(Schema.Array(Pull), ["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", PULL_FIELDS, "--limit", "10"]).pipe(
      Effect.catchTag("HostRefused", (e) => Effect.fail(new HostRefused({ message: `Could not look for a pull request: ${e.message}` }))),
      Effect.flatMap((pulls) => {
        const pull = pickPull(pulls.map(toPull));
        return pull ? Effect.succeed(pull) : Effect.fail(new NoPull({ message: `No pull request for ${branch} yet.` }));
      }),
    );
  },
  comments: (link, pull) => ghRead(Pages(PullComment), ["api", "--paginate", "--slurp", `repos/${repoOf(link)}/pulls/${pull}/comments`]).pipe(Effect.map((pages) => splitComments(pages.flat()))),
  reviews: (link, pull) => ghRead(Pages(Review), ["api", "--paginate", "--slurp", `repos/${repoOf(link)}/pulls/${pull}/reviews`]).pipe(Effect.map((pages) => pages.flat().flatMap((r) => toReview(r) ?? []))),
  conversation: (link, pull) => ghRead(Pages(IssueComment), ["api", "--paginate", "--slurp", `repos/${repoOf(link)}/issues/${pull}/comments`]).pipe(Effect.map((pages) => pages.flat().flatMap((c) => toNote(c) ?? []))),
  openPulls: (link) => ghRead(Schema.Array(Pull), ["pr", "list", "--repo", repoOf(link), "--state", "open", "--json", PULL_FIELDS, "--limit", "200"]).pipe(Effect.map((pulls) => pulls.map(toPull))),
  merges: (link, base, limit = 50) => {
    const r = githubRepo(link)!;
    const page = (after: string | null): Asked<MergesPage> =>
      ghRead(MergesAnswer, ["api", "graphql", "-f", `owner=${r.owner}`, "-f", `repo=${r.repo}`, "-f", `base=${base}`, ...(after ? ["-f", `after=${after}`] : []), "-f", `query=${MERGES_QUERY}`]).pipe(Effect.map(mergesPage));
    // GitHub orders pull requests by when they last changed, not when they
    // merged: pages are read until no later one can hold a later merge
    return Stream.paginate(null as string | null, (after) => Effect.map(page(after), (p) => [[p], Option.fromNullishOr(p.next)] as const)).pipe(
      Stream.take(MERGES_MAX_PAGES),
      Stream.mapAccum(
        (): ReadonlyArray<MergesPage> => [],
        (read, p) => {
          const pages = [...read, p];
          return [pages, [latestMerges(pages, limit)]] as const;
        },
      ),
      Stream.takeUntil((latest) => latest.done),
      Stream.runLast,
      Effect.map(Option.match({ onNone: () => [], onSome: (latest) => latest.merges })),
    );
  },
  submit: (link, pull, review) =>
    Effect.gen(function* () {
      const repo = `repos/${repoOf(link)}/pulls/${pull}`;
      const event = review.verdict === "approve" ? "APPROVE" : review.verdict === "request-changes" ? "REQUEST_CHANGES" : "COMMENT";
      const payload = {
        commit_id: review.commit,
        event,
        ...(review.body.length > 0 ? { body: review.body } : {}),
        comments: review.comments.map((c) => ({ path: c.file, line: c.line, side: c.side, body: c.body, ...(c.start ? { start_line: c.start.line, start_side: c.start.side } : {}) })),
      };
      const answer = yield* gh(["api", "-X", "POST", `${repo}/reviews`, "--input", "-"], { timeout: "30 seconds", input: JSON.stringify(payload) });
      // posted once gh says so: what it answers only adds where it is
      const made = yield* decoded(CreatedReview)(answer).pipe(Effect.option);
      // its comments as GitHub placed them — their ids, to show each once
      const comments = Option.isSome(made) && review.comments.length > 0
        ? yield* ghRead(Pages(PullComment), ["api", "--paginate", "--slurp", `${repo}/reviews/${made.value.id}/comments`]).pipe(
            Effect.map((pages) => splitComments(pages.flat()).inline),
            Effect.orElseSucceed(() => []),
          )
        : [];
      return { url: Option.map(made, (m) => m.html_url), comments };
    }),
  comment: (link, pull, at, body) =>
    // -f sends each as a plain string (never read from a file, as -F's @ would); the line is a number
    gh(["api", "-X", "POST", `repos/${repoOf(link)}/pulls/${pull}/comments`, "-f", `body=${body}`, "-f", `commit_id=${at.commit}`, "-f", `path=${at.file}`, "-F", `line=${at.line}`, "-f", `side=${at.side}`, ...(at.start ? ["-F", `start_line=${at.start.line}`, "-f", `start_side=${at.start.side}`] : [])]).pipe(
      // posted once gh says so: what it answers only adds where it is
      Effect.flatMap((answer) => decoded(PullComment)(answer).pipe(Effect.option)),
      Effect.map(Option.flatMap((c) => Option.fromNullishOr(toLineComment(c)))),
    ),
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
