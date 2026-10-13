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

  it("reads a reordered list as moves, not as removed and added words", () => {
    const d = wordDiff('expect(kinds).toEqual(["proposal", "plan", "bug", "review", "task"]);', 'expect(kinds).toEqual(["proposal", "bug", "plan", "task", "review"]);');
    expect(d!.segments.filter((s) => s.kind === "removed" || s.kind === "added")).toEqual([]);
    expect(d!.segments.filter((s) => s.kind === "moved").map((s) => s.text.replace(/[^a-z]/g, ""))).not.toEqual([]);
    expect(d!.segments.map((s) => s.text).join("")).toBe('expect(kinds).toEqual(["proposal", "bug", "plan", "task", "review"]);');
  });

  it("knows where each moved word stood, for the line as it was", () => {
    const old = "const order = [alpha, beta, gamma, delta, eps];";
    const now = "const order = [eps, gamma, alpha, delta, beta];";
    const d = wordDiff(old, now)!;
    const wasOf = (word: string) => {
      const at = now.indexOf(word);
      const m = d.map.find((w) => at >= w.now && at < w.now + w.len)!;
      return old.slice(m.was + (at - m.now), m.was + (at - m.now) + word.length);
    };
    for (const w of ["alpha", "beta", "gamma", "delta", "eps"]) expect(wasOf(w)).toBe(w);
    expect(d.reorder).toEqual({ moved: 3, words: 7 });
  });

  it("does not mark a line that was only indented deeper", () => {
    const d = wordDiff('    <Show when={x}>', '      <Show when={x}>')!;
    expect(d.segments.filter((s) => s.kind !== "same")).toEqual([]);
    expect(d.segments.map((s) => s.text).join("")).toBe('      <Show when={x}>');
  });

  it("still marks a plain edit as removed and added", () => {
    const d = wordDiff("const limit = 10;", "const limit = 25;");
    expect(d!.segments.map((s) => `${s.kind}:${s.text}`)).toEqual(["same:const limit = ", "removed:10", "added:25", "same:;"]);
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
