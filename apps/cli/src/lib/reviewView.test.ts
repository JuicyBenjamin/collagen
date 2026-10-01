import { describe, expect, it } from "vitest";
import { claimed, groupByWhy, parseDiff, parsePointer, sameFile } from "./reviewView";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 one
+two
 three
 four
@@ -40,2 +41,3 @@ export function far() {
 forty
+forty-one
 forty-two
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

describe("parseDiff", () => {
  const hunks = parseDiff(DIFF);
  it("reads every hunk with its file, numbering new lines", () => {
    expect(hunks.map((h) => h.file)).toEqual(["src/a.ts", "src/a.ts", "src/b.ts", "src/gone.ts"]);
    expect(hunks[0]!.lines.find((l) => l.kind === "+")).toEqual({ kind: "+", text: "two", new: 2 });
    expect(hunks[1]!.newStart).toBe(41);
  });
  it("leaves no phantom line from the final newline", () => {
    expect(hunks[3]!.lines).toEqual([{ kind: "-", text: "bye", old: 1 }]);
  });
});

describe("pointers", () => {
  it("reads file, file:line and file:line-line", () => {
    expect(parsePointer("src/a.ts")).toEqual({ file: "src/a.ts" });
    expect(parsePointer("src/a.ts:42")).toEqual({ file: "src/a.ts", line: 42 });
    expect(parsePointer("src/a.ts:40-44")).toEqual({ file: "src/a.ts", line: 40, end: 44 });
  });
  it("a path matches on a segment boundary, however much of it was written", () => {
    expect(sameFile("apps/cli/src/a.ts", "src/a.ts")).toBe(true);
    expect(sameFile("apps/cli/src/a.ts", "a.ts")).toBe(true);
    expect(sameFile("apps/cli/src/ba.ts", "a.ts")).toBe(false);
  });
  it("claims the hunk holding the line, else the nearest close by, else nothing", () => {
    const hunks = parseDiff(DIFF);
    expect(claimed(parsePointer("src/a.ts:42"), hunks).map((h) => h.id)).toEqual(["src/a.ts#1"]);
    expect(claimed(parsePointer("src/a.ts:50"), hunks).map((h) => h.id)).toEqual(["src/a.ts#1"]);
    expect(claimed(parsePointer("src/a.ts:200"), hunks)).toEqual([]);
    expect(claimed(parsePointer("src/a.ts"), hunks)).toHaveLength(2);
  });
});

describe("groupByWhy", () => {
  const hunks = parseDiff(DIFF);
  const review = {
    decisions: [
      { id: "d1", what: "add two", where: ["src/a.ts:2"] },
      { id: "d2", what: "a new file, and the far edit", where: ["src/b.ts", "src/a.ts:42", "src/c.ts:9"] },
      { id: "d3", what: "also the first line", where: ["src/a.ts:1"] },
    ],
    forks: [
      { id: "f1", at: "src/b.ts:1", chose: "a new file", instead: "inline", why: "separate concern" },
      { id: "f2", at: "src/gone.ts:1", chose: "delete", instead: "keep", why: "dead" },
    ],
  };
  const g = groupByWhy(review, hunks);
  it("a section per decision with the hunks it claims, in diff order", () => {
    expect(g.sections.map((s) => s.hunks)).toEqual([["src/a.ts#0"], ["src/a.ts#1", "src/b.ts#2"], ["src/a.ts#0"]]);
  });
  it("a hunk two decisions claim is shown under both, marked shared", () => {
    expect(g.sections[0]!.shared).toEqual(["src/a.ts#0"]);
    expect(g.sections[1]!.shared).toEqual([]);
  });
  it("forks sit in the section whose hunks they fall in", () => {
    expect(g.sections[1]!.forks.map((f) => f.id)).toEqual(["f1"]);
  });
  it("what the why does not cover is its own finding", () => {
    expect(g.unexplained).toEqual(["src/gone.ts#3"]);
    expect(g.looseForks.map((f) => f.id)).toEqual(["f2"]);
  });
  it("a pointer at code that did not change is said, not dropped", () => {
    expect(g.sections[1]!.unmatched).toEqual(["src/c.ts:9"]);
  });
});
