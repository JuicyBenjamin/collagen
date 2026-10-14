import { describe, expect, it } from "vitest";
import type { DiffLine } from "./data";
import { rowsOf, spansIn, wordDiff } from "./inline";

const del = (text: string, old: number): DiffLine => ({ kind: "-", text, old });
const add = (text: string, line: number): DiffLine => ({ kind: "+", text, new: line });
const context = (text: string, line: number): DiffLine => ({ kind: " ", text, old: line, new: line });

/** A row as one string: `~3/3` for a changed row, else the line's sign and number. */
const shape = (lines: ReadonlyArray<DiffLine>) => rowsOf(lines).map((row) => (row.was ? `~${row.was.line.old}/${row.line.new}` : `${row.line.kind}${row.line.old ?? row.line.new}`));

describe("a line changed in place", () => {
  it("reads as one row when the removed and added lines are alike", () => {
    expect(shape([context("a", 1), del("const x = 1;", 2), add("const x = 2;", 2), context("b", 3)])).toEqual([" 1", "~2/2", " 3"]);
  });

  it("marks only the words that went and came, in place", () => {
    const diff = wordDiff('help: "follows the ticket", tone: 1', 'help: "follows the open ticket", tone: 1')!;
    expect(diff.segments.map((segment) => `${segment.kind[0]}:${segment.text}`)).toEqual(['s:help: "follows the ', "a:open ", 's:ticket", tone: 1']);
    const secondDiff = wordDiff("return fooBar(a, b);", "return fooBaz(a, b);")!;
    expect(secondDiff.segments.map((segment) => `${segment.kind[0]}:${segment.text}@${segment.at}`)).toEqual(["s:return @0", "r:fooBar@7", "a:fooBaz@7", "s:(a, b);@13"]);
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

  it("reads a reordered list as moves, not as removed and added words", () => {
    const diff = wordDiff('expect(kinds).toEqual(["proposal", "plan", "bug", "review", "task"]);', 'expect(kinds).toEqual(["proposal", "bug", "plan", "task", "review"]);');
    expect(diff!.segments.filter((segment) => segment.kind === "removed" || segment.kind === "added")).toEqual([]);
    expect(diff!.segments.filter((segment) => segment.kind === "moved").map((segment) => segment.text.replace(/[^a-z]/g, ""))).not.toEqual([]);
    expect(diff!.segments.map((segment) => segment.text).join("")).toBe('expect(kinds).toEqual(["proposal", "bug", "plan", "task", "review"]);');
  });

  it("knows where each moved word stood, for the line as it was", () => {
    const old = "const order = [alpha, beta, gamma, delta, eps];";
    const now = "const order = [eps, gamma, alpha, delta, beta];";
    const diff = wordDiff(old, now)!;
    const wasOf = (word: string) => {
      const at = now.indexOf(word);
      const match = diff.map.find((piece) => at >= piece.now && at < piece.now + piece.length)!;
      return old.slice(match.was + (at - match.now), match.was + (at - match.now) + word.length);
    };
    for (const word of ["alpha", "beta", "gamma", "delta", "eps"]) expect(wasOf(word)).toBe(word);
    expect(diff.reorder).toEqual({ moved: 3, words: 7 });
  });

  it("does not mark a line that was only indented deeper", () => {
    const diff = wordDiff('    <Show when={x}>', '      <Show when={x}>')!;
    expect(diff.segments.filter((segment) => segment.kind !== "same")).toEqual([]);
    expect(diff.segments.map((segment) => segment.text).join("")).toBe('      <Show when={x}>');
  });

  it("still marks a plain edit as removed and added", () => {
    const diff = wordDiff("const limit = 10;", "const limit = 25;");
    expect(diff!.segments.map((segment) => `${segment.kind}:${segment.text}`)).toEqual(["same:const limit = ", "removed:10", "added:25", "same:;"]);
  });

  it("gives up on lines too long to weigh, and leaves them apart", () => {
    const oldLine = Array.from({ length: 400 }, (_, index) => `w${index}`).join(" ");
    const newLine = Array.from({ length: 400 }, (_, index) => `v${index}`).join(" ");
    expect(wordDiff(oldLine, newLine)).toBeNull();
  });

  it("colours a segment from its own line, cut where the segment is", () => {
    const spans = [{ value: "const", className: "keyword" as const }, { value: " x = " }, { value: "2", className: "number" as const }, { value: ";" }];
    expect(spansIn(spans, "const x = 2;", 3, 11).map((piece) => [piece.span.value, piece.at])).toEqual([["st", 3], [" x = ", 5], ["2", 10]]);
  });
});
