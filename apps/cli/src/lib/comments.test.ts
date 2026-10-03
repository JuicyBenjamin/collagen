import { describe, expect, it } from "vitest";
import type { Hunk } from "@collagen/review-web/data";
import { placeComment } from "./comments";

const hunk: Hunk = {
  id: "src/a.ts#0",
  file: "src/a.ts",
  header: "@@",
  newStart: 10,
  newLines: 4,
  lines: [
    { kind: " ", text: "a", old: 10, new: 10 },
    { kind: "-", text: "b", old: 11 },
    { kind: "+", text: "B", new: 11 },
    { kind: "+", text: "C", new: 12 },
    { kind: " ", text: "d", old: 12, new: 13 },
  ],
};
const later: Hunk = { ...hunk, id: "src/a.ts#1", newStart: 40, lines: [{ kind: "+", text: "x", new: 40 }] };

describe("where a comment can sit", () => {
  it("on a line the diff shows: new lines on the right, a removed one on the left", () => {
    expect(placeComment([hunk], { file: "src/a.ts", line: 12, side: "RIGHT" })).toBeNull();
    expect(placeComment([hunk], { file: "src/a.ts", line: 13, side: "RIGHT" })).toBeNull();
    expect(placeComment([hunk], { file: "src/a.ts", line: 11, side: "LEFT" })).toBeNull();
  });

  it("not on a line it does not show, saying what it does", () => {
    expect(placeComment([hunk, later], { file: "src/a.ts", line: 30, side: "RIGHT" })).toBe("src/a.ts line +30 is not in the diff — it shows +10–13, +40–40");
    expect(placeComment([hunk], { file: "src/a.ts", line: 10, side: "LEFT" })).toMatch(/side 'old' is for a removed line/);
    expect(placeComment([hunk], { file: "src/b.ts", line: 1, side: "RIGHT" })).toBe("src/b.ts is not changed in this review's diff");
  });

  it("a block in one hunk, first line before last — a removed line may start it", () => {
    expect(placeComment([hunk], { file: "src/a.ts", line: 13, side: "RIGHT", startLine: 11, startSide: "LEFT" })).toBeNull();
    expect(placeComment([hunk, later], { file: "src/a.ts", line: 40, side: "RIGHT", startLine: 12 })).toMatch(/must be in one hunk/);
    expect(placeComment([hunk], { file: "src/a.ts", line: 11, side: "RIGHT", startLine: 13 })).toMatch(/starts before it ends/);
  });
});
