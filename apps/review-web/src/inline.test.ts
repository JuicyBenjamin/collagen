import { describe, expect, it } from "vitest";
import type { DiffLine } from "./data";
import { rowsOf, spansIn, wordDiff } from "./inline";

const del = (text: string, old: number): DiffLine => ({ kind: "-", text, old });
const add = (text: string, n: number): DiffLine => ({ kind: "+", text, new: n });
const ctx = (text: string, n: number): DiffLine => ({ kind: " ", text, old: n, new: n });

/** A row as one string: `~3/3` for a changed row, else the line's sign and number. */
const shape = (lines: ReadonlyArray<DiffLine>) => rowsOf(lines).map((r) => (r.was ? `~${r.was.line.old}/${r.line.new}` : `${r.line.kind}${r.line.old ?? r.line.new}`));

describe("a line changed in place", () => {
  it("reads as one row when the removed and added lines are alike", () => {
    expect(shape([ctx("a", 1), del("const x = 1;", 2), add("const x = 2;", 2), ctx("b", 3)])).toEqual([" 1", "~2/2", " 3"]);
  });

  it("marks only the words that went and came, in place", () => {
    const d = wordDiff('help: "follows the ticket", tone: 1', 'help: "follows the open ticket", tone: 1')!;
    expect(d.segments.map((s) => `${s.kind[0]}:${s.text}`)).toEqual(['s:help: "follows the ', "a:open ", 's:ticket", tone: 1']);
    const w = wordDiff("return fooBar(a, b);", "return fooBaz(a, b);")!;
    expect(w.segments.map((s) => `${s.kind[0]}:${s.text}@${s.at}`)).toEqual(["s:return @0", "r:fooBar@7", "a:fooBaz@7", "s:(a, b);@13"]);
  });

  it("keeps unrelated lines apart, even with the same indentation", () => {
    expect(shape([del("    const width = measure(text);", 1), add("    return null;", 1)])).toEqual(["-1", "+1"]);
  });

  it("pairs in order, leaving the line with no likeness as it is", () => {
    const lines = [del("import { a } from './a';", 1), del("import { b } from './b';", 2), add("import { a, c } from './a';", 1), add("// a new comment", 2), add("import { b } from './bee';", 3)];
    expect(shape(lines)).toEqual(["~1/1", "+2", "~2/3"]);
  });

  it("puts what stays removed above what stays added", () => {
    expect(shape([del("gone entirely", 1), del("let n = 1;", 2), add("let n = 10;", 1), add("brand new line", 2)])).toEqual(["-1", "~2/1", "+2"]);
  });

  it("gives up on lines too long to weigh, and leaves them apart", () => {
    const a = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const b = Array.from({ length: 400 }, (_, i) => `v${i}`).join(" ");
    expect(wordDiff(a, b)).toBeNull();
  });

  it("colours a segment from its own line, cut where the segment is", () => {
    const spans = [{ value: "const", className: "keyword" as const }, { value: " x = " }, { value: "2", className: "number" as const }, { value: ";" }];
    expect(spansIn(spans, "const x = 2;", 3, 11).map((s) => [s.span.value, s.at])).toEqual([["st", 3], [" x = ", 5], ["2", 10]]);
  });
});
