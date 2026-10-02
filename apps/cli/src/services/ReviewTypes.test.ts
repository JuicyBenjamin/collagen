import { describe, expect, it } from "vitest";
import { codePathOk, docAbove } from "./ReviewTypes";

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
