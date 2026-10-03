import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { emptyReview, mergeReview, ReviewContext } from "./review";

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
