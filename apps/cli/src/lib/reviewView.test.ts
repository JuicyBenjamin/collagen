import { describe, expect, it } from "vitest";
import { claimed, parseDiff, parsePointer, sameFile } from "./reviewView";

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
