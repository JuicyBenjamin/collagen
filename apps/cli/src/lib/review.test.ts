import { describe, expect, it } from "vitest";
import type { ReviewContext } from "@collagen/p2p";
import { reviewGaps, reviewHeadline, reviewRows } from "./review";

const full = {
  summary: "the opening animation",
  decisions: [{ what: "pure frame functions", userWhy: "she said make it look cool", where: ["src/lib/logoFrame.ts:60"] }],
  forks: [{ at: "src/components/Logo/Logo.tsx:87", chose: "setInterval 30 fps", instead: "the Timeline animator", why: "no dependency, and testable" }],
};

const record: ReviewContext = {
  ticketId: "t1",
  author: "k-alice",
  authorName: "alice",
  summary: "the opening animation",
  branch: "opening",
  base: "main",
  link: "https://github.com/o/r/pull/22",
  decisions: [
    { id: "d1", what: "pure frame functions", userWhy: "make it look cool", agentWhy: "testable frame by frame", where: ["src/lib/logoFrame.ts:60"] },
    { id: "d2", what: "hold a fast boot", userWhy: "fine if it takes longer for animation", where: ["src/lib/opening.ts:14"] },
  ],
  forks: [{ id: "f1", at: "src/components/Logo/Logo.tsx:87", chose: "setInterval", instead: "the Timeline animator", why: "one less dependency", by: "agent" }],
  ts: 10,
};

describe("what a review must carry", () => {
  it("a complete one passes", () => {
    expect(reviewGaps(full, false)).toBe(null);
  });

  it("no summary, no decisions: refused with what to go and do", () => {
    expect(reviewGaps({ ...full, summary: " " }, false)).toMatch(/^failed: pass a summary/);
    expect(reviewGaps({ ...full, decisions: [] }, false)).toMatch(/take them from it/);
  });

  it("a decision with no why at all is refused, naming which", () => {
    const gap = reviewGaps({ ...full, decisions: [{ what: "pure frame functions", where: [] }] }, false);
    expect(gap).toMatch(/decision 1 \("pure frame functions"\) has no why/);
    // one of the two whys is enough
    expect(reviewGaps({ ...full, decisions: [{ what: "x", agentWhy: "mine", where: [] }] }, false)).toBe(null);
  });

  it("a fork needs both roads, a why, and a pointer", () => {
    expect(reviewGaps({ ...full, forks: [{ ...full.forks[0]!, at: "" }] }, false)).toMatch(/point at the code/);
    expect(reviewGaps({ ...full, forks: [{ ...full.forks[0]!, instead: "" }] }, false)).toMatch(/both roads/);
    expect(reviewGaps({ ...full, forks: [{ ...full.forks[0]!, why: "" }] }, false)).toMatch(/has no 'why'/);
  });

  it("an amendment may be forks alone, but not empty", () => {
    expect(reviewGaps({ forks: full.forks }, true)).toBe(null);
    expect(reviewGaps({}, true)).toMatch(/nothing to amend/);
  });
});

describe("reading a review back", () => {
  it("the headline says where the code is and how much why came with it", () => {
    expect(reviewHeadline(record)).toBe("opening → main · https://github.com/o/r/pull/22 · 2 decisions · 1 fork");
    // on a terminal row the link would truncate the counts away
    expect(reviewHeadline(record, { link: false })).toBe("opening → main · 2 decisions · 1 fork");
  });

  it("everything, by default", () => {
    const rows = reviewRows(record);
    expect(rows.decisions.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(rows.decisions[0]?.userWhy).toBe("make it look cool");
    expect(rows.forks[0]?.at).toBe("src/components/Logo/Logo.tsx:87");
  });

  it("or only the part about something — a file, or a phrase the reader used", () => {
    const byFile = reviewRows(record, "opening.ts");
    expect(byFile.decisions.map((d) => d.id)).toEqual(["d2"]);
    expect(byFile.forks).toEqual([]);
    expect(byFile.review.matched).toBe("1 of 2 decisions, 0 of 1 forks");
    expect(reviewRows(record, "Timeline").forks.map((f) => f.id)).toEqual(["f1"]);
    expect(reviewRows(record, "look cool").decisions.map((d) => d.id)).toEqual(["d1"]);
  });
});
