import { describe, expect, it } from "vitest";
import { emptyReview, mergeReview } from "./review";

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

  it("numbering skips ids the author chose itself", () => {
    const r = mergeReview(base, { decisions: [{ id: "d7", what: "x", where: [] }, { what: "y", where: [] }] }, 1);
    expect(r.decisions.map((d) => d.id)).toEqual(["d7", "d2"]);
    const more = mergeReview(r, { decisions: [{ what: "z", where: [] }] }, 2);
    expect(more.decisions.map((d) => d.id)).toEqual(["d7", "d2", "d3"]);
  });
});
