import { Effect } from "effect";
import { hostById, type RepoHost } from "./RepoHost";
import { firstRef, run } from "./ReviewView";

// Who wrote some code, said in a way no host owns. An identity is
// "<kind>:<value>": a login on a host ("github:octocat" — the host's id, so
// another host adds its own kind by being in HOSTS) or an email git records
// on the commits ("git:octo@example.com"), which needs no host at all. Two
// people are the same author when they share one.

/** An identity, lower-cased so case never splits one person in two. */
export const identityOf = (kind: string, value: string): string => `${kind}:${value.trim().toLowerCase()}`;

/** "octocat on GitHub", "octo@example.com in git" — for people. */
export const describeIdentity = (identity: string): string => {
  const at = identity.indexOf(":");
  const kind = identity.slice(0, at);
  const value = identity.slice(at + 1);
  return kind === "git" ? `${value} in git` : `${value} on ${hostById(kind)?.name ?? kind}`;
};

/** The authors of a change as git has them: the emails on its commits,
 *  base..branch in the clone at `path` (local refs first, then origin's). */
export const gitAuthors = (path: string, base: string, branch: string) =>
  Effect.gen(function* () {
    const b = yield* firstRef(path, [branch, `origin/${branch}`]);
    const a = yield* firstRef(path, [base, `origin/${base}`]);
    if (!a || !b) return [] as ReadonlyArray<string>;
    const out = yield* run("git", ["log", "--format=%ae", `${a}..${b}`], path, 10_000);
    return [...new Set((out ?? "").split("\n").map((e) => e.trim()).filter((e) => e.length > 0).map((e) => identityOf("git", e)))];
  });

/** Who the person here is: the email their clone commits as, and their
 *  login on the code's host when one is named and they are signed in to it. */
export const ownIdentities = (path: string | undefined, host: RepoHost | undefined) =>
  Effect.gen(function* () {
    const out: Array<string> = [];
    if (path) {
      const email = (yield* run("git", ["config", "user.email"], path, 5_000))?.trim();
      if (email) out.push(identityOf("git", email));
    }
    if (host) {
      const viewer = yield* host.viewerNow;
      if ("user" in viewer) out.push(identityOf(host.id, viewer.user.login));
    }
    return out as ReadonlyArray<string>;
  });
