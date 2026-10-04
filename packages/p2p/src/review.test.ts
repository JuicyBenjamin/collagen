import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { claimReview, emptyReview, mergeReview, ReviewContext, supersedes } from "./review";

const base = emptyReview("t1", "k-alice", "alice");

describe("a review's why, amended as the work goes on", () => {
  it("the first delta fills it in and numbers what it is given", () => {
    const r = mergeReview(
      base,
      {
        summary: "the opening animation",
        branch: "opening",
        base: "main",
        decisions: [{ what: "pure frame functions", userWhy: "make it look cool", where: ["src/lib/logoFrame.ts:60"] }, { what: "no animation library", agentWhy: "one less dependency", where: [] }],
        forks: [{ at: "src/components/Logo/Logo.tsx:87", chose: "setInterval 30 fps", instead: "the Timeline animator", why: "testable", by: "agent" }],
      },
      10,
    );
    expect(r.decisions.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(r.forks.map((f) => f.id)).toEqual(["f1"]);
    expect(r.branch).toBe("opening");
    expect(r.ts).toBe(10);
  });

  it("a later delta appends, and a repeated id corrects in place", () => {
    const first = mergeReview(base, { summary: "s", decisions: [{ what: "a", where: [] }] }, 10);
    const second = mergeReview(
      first,
      { link: "https://github.com/o/r/pull/22", decisions: [{ id: "d1", what: "a, as the user then wanted it", userWhy: "she said keep it centred", where: ["a.ts:1"] }, { what: "b", where: [] }] },
      20,
    );
    expect(second.decisions.map((d) => [d.id, d.what])).toEqual([
      ["d1", "a, as the user then wanted it"],
      ["d2", "b"],
    ]);
    expect(second.summary).toBe("s"); // not given again: kept
    expect(second.link).toBe("https://github.com/o/r/pull/22");
    expect(second.ts).toBe(20);
  });

  it("a correction replaces the decision, title and all", () => {
    const first = mergeReview(base, { decisions: [{ title: "Exports stream", what: "rows are mapped one at a time", where: [] }] }, 1);
    const fixed = mergeReview(first, { decisions: [{ id: "d1", title: "Big exports finish", what: "rows are mapped as they are read", where: [] }] }, 2);
    expect(fixed.decisions).toEqual([{ id: "d1", title: "Big exports finish", what: "rows are mapped as they are read", where: [] }]);
  });

  it("a decision keeps the skills and agent files that guided it, and a correction can change them", () => {
    const first = mergeReview(base, { decisions: [{ title: "Tokens, not hex", what: "colours from the theme", where: [], guidedBy: ["skill: frontend-design", "CLAUDE.md"] }] }, 1);
    expect(first.decisions[0]?.guidedBy).toEqual(["skill: frontend-design", "CLAUDE.md"]);
    const fixed = mergeReview(first, { decisions: [{ id: "d1", title: "Tokens, not hex", what: "colours from the theme", where: [] }] }, 2);
    expect(fixed.decisions[0]?.guidedBy).toBeUndefined();
  });

  it("units merge by id: new ones numbered, a repeated id corrects one, a retired one goes", () => {
    const first = mergeReview(base, { units: [{ title: "Export streams", what: "rows are streamed", where: ["src/export.ts"] }, { title: "Paging", what: "a hundred a page", where: ["src/page.ts"] }] }, 1);
    expect(first.units?.map((u) => `${u.id} ${u.title}`)).toEqual(["u1 Export streams", "u2 Paging"]);
    const fixed = mergeReview(first, { units: [{ id: "u2", title: "Paging by id", what: "paged by id, not offset", where: ["src/page.ts:3"] }], retireUnits: ["u1"] }, 2);
    expect(fixed.units).toEqual([{ id: "u2", title: "Paging by id", what: "paged by id, not offset", where: ["src/page.ts:3"] }]);
    // a unit stored before units had a line beneath the title still decodes, review and all
    const older = Schema.decodeUnknownSync(ReviewContext)({ ...fixed, units: [{ id: "u2", title: "Paging by id", where: ["src/page.ts"] }] });
    expect(older.units?.[0]?.what).toBeUndefined();
    // a review that never named units has none
    expect(mergeReview(base, { summary: "x" }, 3).units).toBeUndefined();
  });

  it("numbering skips ids the author chose itself", () => {
    const r = mergeReview(base, { decisions: [{ id: "d7", what: "x", where: [] }, { what: "y", where: [] }] }, 1);
    expect(r.decisions.map((d) => d.id)).toEqual(["d7", "d2"]);
    const more = mergeReview(r, { decisions: [{ what: "z", where: [] }] }, 2);
    expect(more.decisions.map((d) => d.id)).toEqual(["d7", "d2", "d3"]);
  });
});

describe("a review built from assumptions", () => {
  it("keeps who wrote the code and what was read, and each guess's basis, through amendments", () => {
    const filed = mergeReview(emptyReview("t", "me", "alice"), {
      summary: "Big exports finish",
      assumed: { author: "octocat", sources: ["PR #7 description", "JIRA-12"] },
      decisions: [{ title: "Stream the rows", what: "rows go out as they are read", agentWhy: "probably the timeouts in JIRA-12", basis: "PR description: 'exports time out'", confidence: "high", where: ["src/export.ts:2"] }],
      forks: [{ at: "src/export.ts:2", chose: "a stream", instead: "paging", why: "fewer round trips", basis: "the code", confidence: "low" }],
    }, 1);
    const amended = mergeReview(filed, { decisions: [{ id: "d2", title: "Pages of 100", what: "a page holds 100 rows", basis: "a constant", confidence: "medium" }] }, 2);
    expect(amended.assumed).toEqual({ author: "octocat", sources: ["PR #7 description", "JIRA-12"] });
    expect(amended.decisions.map((d) => [d.id, d.basis, d.confidence])).toEqual([
      ["d1", "PR description: 'exports time out'", "high"],
      ["d2", "a constant", "medium"],
    ]);
    expect(amended.forks[0]).toMatchObject({ basis: "the code", confidence: "low" });
    // and it goes over the wire as it is
    expect(Schema.decodeUnknownSync(ReviewContext)(JSON.parse(JSON.stringify(amended)))).toEqual(amended);
  });

  it("a review from before assumptions still decodes, with none", () => {
    const old = { ticketId: "t", author: "me", authorName: "alice", summary: "s", decisions: [{ id: "d1", what: "w", where: [] }], forks: [], ts: 1 };
    const got = Schema.decodeUnknownSync(ReviewContext)(old);
    expect(got.assumed).toBeUndefined();
    expect(got.decisions[0]!.basis).toBeUndefined();
  });
});

describe("the code's author takes an assumed review over", () => {
  const guessed = mergeReview(emptyReview("t", "alice-key", "alice"), {
    summary: "Big exports finish",
    assumed: { author: "octocat", sources: ["PR #7"] },
    decisions: [
      { title: "Stream the rows", what: "rows go out as read", agentWhy: "timeouts", basis: "the description", confidence: "high", where: ["src/export.ts:2"] },
      { title: "Pages of 100", what: "a page holds 100 rows", agentWhy: "memory", basis: "a constant", confidence: "low", where: ["src/page.ts:2"] },
      { title: "Strings out", what: "rows become strings", agentWhy: "simpler", basis: "the map", confidence: "medium", where: ["src/export.ts:2"] },
      { title: "Retry", what: "it retries", agentWhy: "flaky", basis: "a loop", confidence: "low", where: [] },
    ],
    forks: [{ at: "src/export.ts:2", chose: "a stream", instead: "paging", why: "round trips", basis: "the code", confidence: "low" }],
  }, 5);

  it("answers each guess as they say, keeps the unanswered ones guesses, and is theirs from then on", () => {
    const told = claimReview(
      guessed,
      { key: "octo-key", name: "octocat" },
      [
        { id: "d1", verdict: "confirmed" },
        { id: "d2", verdict: "corrected", title: "Pages of 50", what: "a page holds 50 rows", userWhy: "the mobile client's memory" },
        { id: "d3", verdict: "wrong", userWhy: "strings were a stopgap; objects next" },
        { id: "f1", verdict: "corrected", chose: "a stream", instead: "a job queue", userWhy: "no infra for a queue" },
      ],
      { decisions: [{ title: "No auth change", what: "exports keep the session", userWhy: "out of scope" }] },
      9,
    );
    expect(told.author).toBe("octo-key");
    expect(told.claimed).toEqual({ guessedBy: "alice-key", guessedByName: "alice", at: 9 });
    expect(told.assumed).toEqual(guessed.assumed);
    const [d1, d2, d3, d4, d5] = told.decisions;
    expect(d1).toMatchObject({ verdict: "confirmed", basis: "the description" });
    expect(d2).toMatchObject({ verdict: "corrected", title: "Pages of 50", what: "a page holds 50 rows", userWhy: "the mobile client's memory", guess: { what: "a page holds 100 rows", why: "memory", basis: "a constant" } });
    expect(d2!.basis).toBeUndefined();
    expect(d3).toMatchObject({ verdict: "wrong", userWhy: "strings were a stopgap; objects next" });
    expect(d4!.verdict).toBeUndefined();
    expect(d5).toMatchObject({ id: "d5", title: "No auth change", userWhy: "out of scope" });
    expect(told.forks[0]).toMatchObject({ verdict: "corrected", instead: "a job queue", why: "no infra for a queue", by: "user", guess: { what: "a stream over paging" } });
    expect(Schema.decodeUnknownSync(ReviewContext)(JSON.parse(JSON.stringify(told)))).toEqual(told);
  });

  it("a taken-over review beats a guessed one, whatever their clocks say and however they arrive", () => {
    const told = claimReview(guessed, { key: "octo-key", name: "octocat" }, [{ id: "d1", verdict: "confirmed" }], {}, 9);
    const lateGuess = mergeReview(guessed, { decisions: [{ title: "x", what: "y", agentWhy: "z", basis: "b", confidence: "low" }] }, 99);
    expect(supersedes(told, lateGuess)).toBe(true);
    expect(supersedes(lateGuess, told)).toBe(false);
    // between two of one kind, the later
    expect(supersedes(lateGuess, guessed)).toBe(true);
    const laterTold = mergeReview(told, { decisions: [{ title: "More", what: "m", userWhy: "u" }] }, 12);
    expect(supersedes(laterTold, told)).toBe(true);
    expect(supersedes(told, laterTold)).toBe(false);
    // a told review never filed from guesses is ranked with the taken over
    const plain = mergeReview(emptyReview("t", "k", "n"), { summary: "s", decisions: [{ title: "a", what: "b", userWhy: "c" }] }, 1);
    expect(supersedes(plain, lateGuess)).toBe(true);
  });
});

describe("a guess withdrawn", () => {
  it("goes, and its id is never given to another", () => {
    const guess = (title: string) => ({ title, what: title, agentWhy: "w", basis: "b", confidence: "low" as const });
    const filed = mergeReview(emptyReview("t", "me", "alice"), { summary: "s", assumed: { author: "octo", sources: ["x"] }, decisions: [guess("one"), guess("two"), guess("three")] }, 1);
    const trimmed = mergeReview(filed, { retireGuesses: ["d3", "d2"] }, 2);
    expect(trimmed.decisions.map((d) => d.id)).toEqual(["d1"]);
    expect(trimmed.retired).toEqual(["d3", "d2"]);
    const more = mergeReview(trimmed, { decisions: [guess("four")] }, 3);
    expect(more.decisions.map((d) => d.id)).toEqual(["d1", "d4"]);
    expect(Schema.decodeUnknownSync(ReviewContext)(JSON.parse(JSON.stringify(more)))).toEqual(more);
  });
});
