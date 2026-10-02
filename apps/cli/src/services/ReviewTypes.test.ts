import { describe, expect, it } from "vitest";
import { codePathOk, docAbove, splitLeadingDoc } from "./ReviewTypes";

describe("docAbove", () => {
  it("takes a JSDoc block whole, however long, as text", () => {
    const lines = ["/**", ...Array.from({ length: 40 }, (_, i) => ` * line ${i}`), " * @example", " */", "export function f() {}"];
    const doc = docAbove(lines, lines.length - 1)!;
    expect(doc.startsWith("line 0")).toBe(true);
    expect(doc).toContain("line 39\n@example");
    expect(doc).not.toMatch(/\*\//);
  });
  it("takes a run of // lines, and nothing from a plain /* */ block or code", () => {
    expect(docAbove(["// one", "// two", "const a = 1"], 2)).toBe("one\ntwo");
    expect(docAbove(["/* not docs */", "const a = 1"], 1)).toBeNull();
    expect(docAbove(["const b = 2", "const a = 1"], 1)).toBeNull();
  });
});

describe("codePathOk", () => {
  it("a relative code file inside the tree only", () => {
    expect(codePathOk("src/a.ts")).toBe(true);
    expect(codePathOk("../a.ts")).toBe(false);
    expect(codePathOk("/etc/a.ts")).toBe(false);
    expect(codePathOk("src/a.css")).toBe(false);
  });
});

describe("splitLeadingDoc", () => {
  it("a doc comment on the declaration's own line: the doc, and the code from right after it", () => {
    const lines = ["/** docs */ function example(): string {", "    return 'x';", "}"];
    expect(splitLeadingDoc(lines, 0, 2)).toEqual({ doc: "docs", code: ["function example(): string {", "    return 'x';", "}"], line: 0 });
  });
  it("a doc block above the declaration: the code starts on the line after it", () => {
    const lines = ["    /**", "     * The rows.", "     * @return array", "     */", "    public function fetch(): array;"];
    expect(splitLeadingDoc(lines, 0, 4)).toEqual({ doc: "The rows.\n@return array", code: ["    public function fetch(): array;"], line: 4 });
  });
  it("a range that does not start on a doc comment is left alone", () => {
    expect(splitLeadingDoc(["function f() {}", "/** later */"], 0, 1)).toBeNull();
    expect(splitLeadingDoc(["/** never closed", "function f() {}"], 0, 1)).toBeNull();
  });
});
