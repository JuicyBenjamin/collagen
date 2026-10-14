import { describe, expect, it } from "vitest";
import type { Hunk } from "./data";
import { addedLines, hasNewSide, removedLines, wholeHunk } from "./whole";

const hunk: Hunk = {
  id: "a.ts#0",
  file: "a.ts",
  header: "@@ -1,2 +1,3 @@",
  newStart: 1,
  newLines: 3,
  lines: [
    { kind: " ", text: "one", old: 1, new: 1 },
    { kind: "-", text: "two", old: 2 },
    { kind: "+", text: "TWO", new: 2 },
    { kind: "+", text: "three", new: 3 },
  ],
};

describe("a file read whole", () => {
  it("marks the lines the diff adds, by their number in the new file", () => {
    const added = addedLines([hunk, { ...hunk, id: "b.ts#0", file: "b.ts", lines: [{ kind: "+", text: "x", new: 7 }] }]);
    expect([...added.get("a.ts")!]).toEqual([2, 3]);
    expect([...added.get("b.ts")!]).toEqual([7]);
  });

  it("is every line of the file, numbered, the added ones as added", () => {
    const whole = wholeHunk(hunk, ["one", "TWO", "three", "four"], new Set([2, 3]));
    expect(whole.lines.map((line) => `${line.kind}${line.new} ${line.text}`)).toEqual([" 1 one", "+2 TWO", "+3 three", " 4 four"]);
    expect(whole.id).not.toBe(hunk.id);
  });

  it("puts back what the diff removed, above the line that took its place, so a changed line never reads as new", () => {
    const whole = wholeHunk(hunk, ["one", "TWO", "three", "four"], new Set([2, 3]), removedLines([hunk]).get("a.ts"));
    expect(whole.lines.map((line) => `${line.kind}${line.old ?? ""}/${line.new ?? ""} ${line.text}`)).toEqual([" /1 one", "-2/ two", "+/2 TWO", "+/3 three", " /4 four"]);
  });

  it("keeps a removal at the file's end at the end", () => {
    const tail: typeof hunk = { ...hunk, header: "@@ -3,2 +3,1 @@", newStart: 3, newLines: 1, lines: [{ kind: " ", text: "three", old: 3, new: 3 }, { kind: "-", text: "last", old: 4 }] };
    expect(wholeHunk(tail, ["one", "two", "three"], new Set(), removedLines([tail]).get("a.ts")).lines.map((line) => line.text)).toEqual(["one", "two", "three", "last"]);
  });

  it("is only offered where the hunk has a new side", () => {
    expect(hasNewSide(hunk)).toBe(true);
    expect(hasNewSide({ ...hunk, lines: [{ kind: "-", text: "gone", old: 1 }] })).toBe(false);
  });
});
