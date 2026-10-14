import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { github, type HostPull, type RepoHost } from "./RepoHost";
import { readDiff } from "./ReviewView";

// A merged pull request is still reviewed: its branch merged into the base
// (no change left between them) or deleted, the diff is read by the pull
// request's own commits; where even that fails, the reason names what is missing.

const git = (cwd: string, ...args: Array<string>) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

let origin = "";
let clone = "";
let mergedPull: HostPull;
let squashedPull: HostPull;

const pullOf = (number: number, head: string, merged: string): HostPull => ({ number, url: `https://example.test/pull/${number}`, title: "", state: "merged", draft: false, author: "bob", head, mine: false, branch: "", base: "main", merged });
const hostWith = (pull: HostPull, pullDiff: string | null = null): RepoHost => ({ ...github, name: "TheHost", pull: () => Effect.succeed({ pull }), pullDiff: () => Effect.succeed(pullDiff) });

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "collagen-merged-"));
  origin = join(directory, "origin");
  execFileSync("git", ["init", "-q", "-b", "main", origin]);
  git(origin, "config", "user.email", "t@collagen.test");
  git(origin, "config", "user.name", "t");
  writeFileSync(join(origin, "a.txt"), "one\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "base");
  // a branch merged with a merge commit, and kept
  git(origin, "checkout", "-qb", "feat/kept");
  writeFileSync(join(origin, "a.txt"), "one\ntwo\n");
  git(origin, "commit", "-qam", "two");
  const keptHead = git(origin, "rev-parse", "HEAD");
  git(origin, "update-ref", "refs/pull/1/head", keptHead);
  git(origin, "checkout", "-q", "main");
  git(origin, "merge", "-q", "--no-ff", "-m", "merge kept", "feat/kept");
  mergedPull = { ...pullOf(1, keptHead, git(origin, "rev-parse", "HEAD")), branch: "feat/kept" };
  // a branch squashed in, and deleted: only the host's own ref holds its head
  git(origin, "checkout", "-qb", "feat/gone");
  writeFileSync(join(origin, "b.txt"), "three\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "three");
  const goneHead = git(origin, "rev-parse", "HEAD");
  git(origin, "update-ref", "refs/pull/2/head", goneHead);
  git(origin, "checkout", "-q", "main");
  git(origin, "merge", "-q", "--squash", "feat/gone");
  git(origin, "commit", "-qm", "squash gone");
  git(origin, "branch", "-qD", "feat/gone");
  squashedPull = { ...pullOf(2, goneHead, git(origin, "rev-parse", "HEAD")), branch: "feat/gone" };
  clone = join(directory, "clone");
  execFileSync("git", ["clone", "-q", origin, clone]);
});

const files = (diff: string) => [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);

describe("a merged pull request's diff", () => {
  it("merged with a merge commit: read against the base just before the merge", async () => {
    const got = await Effect.runPromise(readDiff({ base: "main", branch: "feat/kept", link: "x" }, { path: clone }, false, hostWith(mergedPull)));
    expect(got.kind).toBe("clone");
    if (got.kind !== "clone") return;
    expect(files(got.diff)).toEqual(["a.txt"]);
    expect(got.commit).toBe(mergedPull.head);
  });

  it("its branch deleted: its head fetched from the host's ref", async () => {
    const got = await Effect.runPromise(readDiff({ base: "main", branch: "feat/gone", link: "x" }, { path: clone }, true, hostWith(squashedPull)));
    expect(got.kind).toBe("clone");
    if (got.kind !== "clone") return;
    expect(files(got.diff)).toEqual(["b.txt"]);
    expect(got.commit).toBe(squashedPull.head);
  });

  it("no host to ask: no diff, and the reason says there is no change", async () => {
    const got = await Effect.runPromise(readDiff({ base: "main", branch: "feat/kept" }, { path: clone }, false));
    expect(got).toEqual({ kind: "none", why: "feat/kept has no changes against main" });
  });

  it("nothing left to read: the reason names the branch and the commit missing", async () => {
    const lost = { ...squashedPull, number: 3, head: "f".repeat(40) };
    const got = await Effect.runPromise(readDiff({ base: "main", branch: "feat/never", link: "x" }, { path: clone }, false, hostWith(lost)));
    expect(got.kind).toBe("none");
    expect(got.why).toContain("feat/never is not in your clone");
    expect(got.why).toContain("#3's last commit fffffff is not in your clone, nor on TheHost");
  });

  it("the host's own diff of it, when the clone cannot", async () => {
    const lost = { ...squashedPull, number: 3, head: "f".repeat(40) };
    const got = await Effect.runPromise(readDiff({ base: "main", branch: "feat/never", link: "x" }, { path: clone }, false, hostWith(lost, "diff --git a/c b/c\n")));
    expect(got.kind).toBe("host");
  });
});

// A branch rebased onto its target after other work landed there: the
// review shows the branch's own changes, never the work it was rebased over.
describe("a rebased branch's diff", () => {
  let repo = "";
  let mine = "";
  let parentPull: HostPull;

  beforeAll(() => {
    const directory = mkdtempSync(join(tmpdir(), "collagen-rebased-"));
    repo = join(directory, "origin");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git(repo, "config", "user.email", "t@collagen.test");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    git(repo, "branch", "release");
    // a stack: parent, and child on it
    git(repo, "checkout", "-qb", "parent");
    writeFileSync(join(repo, "p.txt"), "parent\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "parent");
    git(repo, "checkout", "-qb", "child");
    writeFileSync(join(repo, "c.txt"), "child\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "child");
    const childCommit = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-q", "main");
    // the reader's clone, with its own branches of the stack and of release, as GitButler keeps them
    mine = join(directory, "mine");
    execFileSync("git", ["clone", "-q", repo, mine]);
    for (const branch of ["release", "parent", "child"]) git(mine, "branch", "-q", branch, `origin/${branch}`);
    // then on origin: other work lands in release, the parent is squashed in and deleted
    git(repo, "checkout", "-q", "release");
    writeFileSync(join(repo, "x.txt"), "someone else\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "other work");
    git(repo, "merge", "-q", "--squash", "parent");
    git(repo, "commit", "-qm", "squash parent");
    parentPull = { number: 9, url: "https://example.test/pull/9", title: "", state: "merged", draft: false, author: "bob", head: git(repo, "rev-parse", "parent"), mine: false, branch: "parent", base: "release", merged: git(repo, "rev-parse", "HEAD") };
    git(repo, "branch", "-qD", "parent");
    // and the child rebased onto release, as the reader's branch is too
    git(repo, "checkout", "-qB", "child", "release");
    git(repo, "cherry-pick", childCommit);
    git(mine, "fetch", "-q", "origin");
    git(mine, "branch", "-qf", "child", "origin/child");
  });

  it("against a base the clone has a stale copy of: the fresh one", async () => {
    const got = await Effect.runPromise(readDiff({ base: "release", branch: "child" }, { path: mine }, false));
    expect(got.kind).toBe("clone");
    if (got.kind === "clone") expect(files(got.diff)).toEqual(["c.txt"]);
  });

  it("against a base merged and deleted since: what it was merged into", async () => {
    const got = await Effect.runPromise(readDiff({ base: "parent", branch: "child", link: "https://example.test/acme/shop" }, { path: mine }, false, hostWith(parentPull)));
    expect(got.kind).toBe("clone");
    if (got.kind === "clone") expect(files(got.diff)).toEqual(["c.txt"]);
  });
});
