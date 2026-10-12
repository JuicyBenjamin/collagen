import { describe, expect, it } from "vitest";
import type { ReviewContext, ReviewDecision, Ticket } from "@collagen/p2p";
import type { HostMerge } from "../services/RepoHost";
import { DECISIONS_EACH, mergeOn, mergesTouching, whyRows } from "./askWhy";

const merge = (number: number, kind: HostMerge["kind"], commit: string, commits = 1, at = `2026-10-0${number}T00:00:00Z`): HostMerge => ({
  number,
  url: `https://github.com/acme/shop/pull/${number}`,
  title: `PR ${number}`,
  branch: `b${number}`,
  kind,
  commit,
  commits,
  at,
});

// main's first-parent history, newest first: #4 rebased c7..c9 (3 commits),
// c6 pushed by hand, #3 a merge commit (its branch's commits are not on it),
// #2 squashed, #1 fast-forwarded c2..c3
const chain = ["c9", "c8", "c7", "c6", "m3", "s2", "c3", "c2", "c1"];
const merges = [merge(4, "rebase", "c9", 3), merge(3, "merge", "m3", 5), merge(2, "squash", "s2", 4), merge(1, "fast-forward", "c3", 2)];

describe("the merge that put a commit on the branch", () => {
  it("covers a rebase's and a fast-forward's own commits, a squash's and a merge's one", () => {
    expect(["c9", "c8", "c7", "m3", "s2", "c3", "c2"].map((commit) => mergeOn(chain, merges, commit)?.number)).toEqual([4, 4, 4, 3, 2, 1, 1]);
  });

  it("none for a commit pushed without one, one older than the merges, or one off the history", () => {
    expect(["c6", "c1", "x"].map((commit) => mergeOn(chain, merges, commit))).toEqual([undefined, undefined, undefined]);
  });

  it("the merges that touched a file, the latest first, each once", () => {
    expect(mergesTouching(chain, merges, ["c2", "c8", "c7", "c6", "s2"]).map((merge) => merge.number)).toEqual([4, 2, 1]);
  });
});

const ticket = (id: string): Ticket => ({ id, kind: "review", goal: `goal ${id}`, title: `Title ${id}`, createdBy: "k-ann", project: "shop", steps: [] }) as unknown as Ticket;
const decision = (id: string, where: ReadonlyArray<string>, extra: Partial<ReviewDecision> = {}): ReviewDecision => ({ id, title: id, what: `what ${id}`, userWhy: `why ${id}`, where, ...extra });
const review = (ticketId: string, decisions: ReadonlyArray<ReviewDecision>, extra: Partial<ReviewContext> = {}): ReviewContext => ({
  ticketId,
  author: "k-ann",
  authorName: "ann",
  summary: `summary ${ticketId}`,
  decisions,
  forks: [{ id: "f1", at: "src/a.ts:3", chose: "a", instead: "b", why: "c" }],
  ts: 0,
  ...extra,
});

describe("the why given back", () => {
  it("the decisions about the file when there are some, the rest counted", () => {
    const told = review("t1", [decision("d1", ["src/a.ts:10"]), decision("d2", ["src/b.ts"]), decision("d3", ["a.ts:4-9"])]);
    const rows = whyRows([{ merge: merges[0]!, tickets: [ticket("t1")] }], new Map([["t1", told]]), "src/a.ts", () => "ann");
    expect(rows.decisions.map((given) => given.id)).toEqual(["d1", "d3"]);
    expect(rows.tickets[0]).toMatchObject({ pull: 4, id: "t1", title: "Title t1", by: "ann", why: "told", more: "1 decision(s), 0 fork(s)" });
  });

  it("a few at most when none is about the file, and a merge from no ticket still listed", () => {
    const many = Array.from({ length: DECISIONS_EACH + 2 }, (_, index) => decision(`d${index}`, ["src/z.ts"]));
    const rows = whyRows(
      [
        { merge: merges[0]!, tickets: [ticket("t1")] },
        { merge: merges[1]!, tickets: [] },
      ],
      new Map([["t1", review("t1", many)]]),
      "src/a.ts",
      () => "ann",
    );
    expect(rows.decisions).toHaveLength(DECISIONS_EACH);
    expect(rows.merges.map((row) => [row.pull, row.tickets])).toEqual([
      [4, 1],
      [3, 0],
    ]);
  });

  it("says which why is a guess, and what its code's author made of it", () => {
    const guessed = review("t1", [decision("d1", [], { confidence: "high", basis: "the pull request" })], { assumed: { author: "bob", sources: ["pr"] } });
    const answered = review("t2", [decision("d1", [], { basis: "x", verdict: "wrong" }), decision("d2", [], { basis: "x" }), decision("d3", [])], {
      assumed: { author: "bob", sources: ["pr"] },
      claimed: { guessedBy: "k-ann", guessedByName: "ann", at: 1 },
    });
    const rows = whyRows([{ merge: merges[0]!, tickets: [ticket("t1"), ticket("t2"), ticket("t3")] }], new Map([["t1", guessed], ["t2", answered]]), undefined, () => "ann");
    expect(rows.decisions.map((given) => [given.ticket, given.standing])).toEqual([
      ["t1", "guess, high"],
      ["t2", "wrong"],
      ["t2", "guess"],
      ["t2", ""],
    ]);
    expect(rows.tickets.map((row) => row.why)).toEqual(["guessed by ann's AI", "guessed, then answered by the code's author", "not here yet"]);
  });
});
