import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { describeIdentity, gitAuthors, identityOf, ownIdentities } from "./Authorship";

describe("who wrote some code, said in a way no host owns", () => {
  it("an identity is a kind and a value, case never splitting one person", () => {
    expect(identityOf("github", "OctoCat")).toBe("github:octocat");
    expect(identityOf("git", " Octo@Example.com ")).toBe("git:octo@example.com");
    expect(describeIdentity("github:octocat")).toBe("octocat on GitHub");
    expect(describeIdentity("git:octo@example.com")).toBe("octo@example.com in git");
    // a host collagen does not know yet is still named
    expect(describeIdentity("gitlab:octo")).toBe("octo on gitlab");
  });

  it("git names a change's authors and the person committing here — no host needed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "authorship-"));
    const git = (...args: Array<string>) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "base@example.com");
    git("config", "user.name", "base");
    writeFileSync(join(dir, "a"), "1");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feat");
    for (const who of ["Ann@Example.com", "bo@example.com"]) {
      git("config", "user.email", who);
      writeFileSync(join(dir, "a"), who);
      git("commit", "-qam", who);
    }
    expect(await Effect.runPromise(gitAuthors(dir, "main", "feat"))).toEqual(["git:bo@example.com", "git:ann@example.com"]);
    expect(await Effect.runPromise(ownIdentities(dir, undefined))).toEqual(["git:bo@example.com"]);
    expect(await Effect.runPromise(gitAuthors(dir, "main", "nope"))).toEqual([]);
  });
});
