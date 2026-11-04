import { describe, expect, it } from "vitest";
import { changesOf, findMoved, followBlock, followLine } from "./follow";

// a -U0 diff: three lines put in after old line 2, old line 6 rewritten, old lines 9–10 taken out
const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -2,0 +3,3 @@ head
+one
+two
+three
@@ -6 +9 @@
-old six
+new six
@@ -9,2 +11,0 @@
-nine
-ten
`;
const changes = changesOf(DIFF);

describe("a comment follows its lines when the branch moves", () => {
  it("moves a line down by what was put in above it", () => {
    expect(followLine(changes, 1)).toBe(1);
    expect(followLine(changes, 3)).toBe(6);
  });

  it("never moves a comment onto a line that changed or went: it is outdated", () => {
    expect(followLine(changes, 6)).toBeNull();
    expect(followLine(changes, 9)).toBeNull();
    expect(followLine(changes, 10)).toBeNull();
  });

  it("moves a line below a removal up by what was taken out", () => {
    // old 11: +3 above, then -2: 12
    expect(followLine(changes, 11)).toBe(12);
  });

  it("follows a block only when every line of it is kept", () => {
    expect(followBlock(changes, 3, 5)).toEqual({ from: 6, to: 8 });
    expect(followBlock(changes, 5, 7)).toBeNull();
  });

  it("finds a block moved whole, when the file has it once — never a brace, never one there twice", () => {
    const before = ["function a() {", "  return computeTheTotal(items);", "}", "x"];
    expect(findMoved(before, ["x", "", "function a() {", "  return computeTheTotal(items);", "}"], 1, 2)).toEqual({ from: 3, to: 4 });
    expect(findMoved(before, ["  return computeTheTotal(items);", "  return computeTheTotal(items);"], 2, 2)).toBeNull();
    expect(findMoved(before, ["}", "y"], 3, 3)).toBeNull();
  });
});
