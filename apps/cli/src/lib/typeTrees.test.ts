import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claimSlot, releaseSlot, treeAt } from "./typeTrees";

const base = mkdtempSync(join(tmpdir(), "collagen-trees-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd: string, ...args: Array<string>) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const commit = (repo: string, files: Record<string, string | null>): string => {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) rmSync(join(repo, path));
    else {
      mkdirSync(join(repo, path, ".."), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
  }
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
  return git(repo, "rev-parse", "HEAD");
};

describe("treeAt", () => {
  it("moves a kept tree by what changed: an unchanged file keeps its time, a changed one is new, a removed one goes", async () => {
    const repo = join(base, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    const first = commit(repo, { "src/Same.php": "<?php // same", "src/Edit.php": "<?php // one", "src/Gone.php": "<?php" });
    const second = commit(repo, { "src/Edit.php": "<?php // two", "src/Gone.php": null, "src/New.php": "<?php // new" });
    const tree = join(base, "tree");
    const stamp = join(base, "stamp");
    await treeAt(repo, first, tree, stamp);
    expect(readFileSync(stamp, "utf8")).toBe(first);
    // what the server last read: an hour ago
    const then = new Date(Math.floor(Date.now() / 1000) * 1000 - 3_600_000);
    for (const path of ["src/Same.php", "src/Edit.php"]) utimesSync(join(tree, path), then, then);
    await treeAt(repo, second, tree, stamp);
    expect(readFileSync(stamp, "utf8")).toBe(second);
    expect(Math.round(statSync(join(tree, "src/Same.php")).mtimeMs)).toBe(then.getTime());
    expect(readFileSync(join(tree, "src/Edit.php"), "utf8")).toBe("<?php // two");
    expect(statSync(join(tree, "src/Edit.php")).mtimeMs).toBeGreaterThan(then.getTime());
    expect(existsSync(join(tree, "src/Gone.php"))).toBe(false);
    expect(readFileSync(join(tree, "src/New.php"), "utf8")).toBe("<?php // new");
  });

  it("never writes through a linked folder into the clone", async () => {
    const repo = join(base, "repo2");
    mkdirSync(repo);
    git(repo, "init", "-q");
    const first = commit(repo, { "composer.json": "{}", "vendor/acme/A.php": "<?php // committed" });
    const second = commit(repo, { "vendor/acme/A.php": null });
    // the clone's own vendor/, as a Composer install leaves it
    const theirs = join(base, "theirs");
    mkdirSync(join(theirs, "acme"), { recursive: true });
    writeFileSync(join(theirs, "acme/A.php"), "<?php // installed");
    const tree = join(base, "tree2");
    const stamp = join(base, "stamp2");
    await treeAt(repo, first, tree, stamp);
    rmSync(join(tree, "vendor"), { recursive: true });
    symlinkSync(theirs, join(tree, "vendor"), "dir");
    await treeAt(repo, second, tree, stamp);
    expect(readFileSync(join(theirs, "acme/A.php"), "utf8")).toBe("<?php // installed");
  });

  it("without a usable stamp, unpacks it whole", async () => {
    const repo = join(base, "repo");
    const head = git(repo, "rev-parse", "HEAD");
    const tree = join(base, "tree3");
    writeFileSync(join(base, "stamp3"), "0000000000000000000000000000000000000000");
    mkdirSync(tree);
    writeFileSync(join(tree, "stale.php"), "<?php");
    await treeAt(repo, head, tree, join(base, "stamp3"));
    expect(existsSync(join(tree, "stale.php"))).toBe(false);
    expect(existsSync(join(tree, "src/New.php"))).toBe(true);
  });
});

describe("slots", () => {
  it("one server per slot: a second review of the same clone takes the next; given back, the first is taken again", () => {
    const one = claimSlot(base, "/some/clone", "php");
    const two = claimSlot(base, "/some/clone", "php");
    expect(two.dir).not.toBe(one.dir);
    expect(claimSlot(base, "/other/clone", "php").dir.endsWith("-php-0")).toBe(true);
    releaseSlot(one);
    expect(claimSlot(base, "/some/clone", "php").dir).toBe(one.dir);
  });
});
