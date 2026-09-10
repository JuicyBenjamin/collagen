import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { branchLink, branchOf, repoWebUrl } from "./gitInfo";

const CONFIG = (url: string) => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;

let plain = "";
let worktree = "";
let bare = "";

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "collagen-git-"));

  // an ordinary checkout
  plain = join(tmp, "repo");
  mkdirSync(join(plain, ".git"), { recursive: true });
  writeFileSync(join(plain, ".git", "HEAD"), "ref: refs/heads/feature/review-tickets\n");
  writeFileSync(join(plain, ".git", "config"), CONFIG("git@github.com:JuicyBenjamin/collagen.git"));

  // a worktree: .git is a pointer, HEAD is its own, config is the repo's
  worktree = join(tmp, "wt");
  mkdirSync(worktree, { recursive: true });
  const wtDir = join(plain, ".git", "worktrees", "wt");
  mkdirSync(wtDir, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${wtDir}\n`);
  writeFileSync(join(wtDir, "HEAD"), "ref: refs/heads/opening\n");
  writeFileSync(join(wtDir, "commondir"), "../..\n");

  // no repo at all
  bare = join(tmp, "notarepo");
  mkdirSync(bare, { recursive: true });
});

describe("what a project's .git says", () => {
  it("reads the branch and the origin as an https link", () => {
    expect(branchOf(plain)).toBe("feature/review-tickets");
    expect(repoWebUrl(plain)).toBe("https://github.com/JuicyBenjamin/collagen");
    expect(branchLink(plain, "feature/review-tickets")).toBe("https://github.com/JuicyBenjamin/collagen/tree/feature/review-tickets");
  });

  it("follows a worktree's gitdir pointer for HEAD and its commondir for the remote", () => {
    expect(branchOf(worktree)).toBe("opening");
    expect(repoWebUrl(worktree)).toBe("https://github.com/JuicyBenjamin/collagen");
  });

  it("an https remote and a detached head are both fine", () => {
    writeFileSync(join(plain, ".git", "config"), CONFIG("https://github.com/o/r/"));
    expect(repoWebUrl(plain)).toBe("https://github.com/o/r");
    writeFileSync(join(plain, ".git", "HEAD"), "9c1f0b2e4d5a6b7c8d9e0f1a2b3c4d5e6f708192\n");
    expect(branchOf(plain)).toBe(null);
  });

  it("a folder that is not a repo says nothing", () => {
    expect(branchOf(bare)).toBe(null);
    expect(repoWebUrl(bare)).toBe(null);
    expect(branchLink(bare, "x")).toBe(null);
  });
});
