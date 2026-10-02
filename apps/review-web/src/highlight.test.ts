import { describe, expect, it } from "vitest";
import { highlightHunk, languageOf, splitLines } from "./highlight";

describe("languageOf", () => {
  it("goes by the extension, plain text when unknown", () => {
    expect(languageOf("apps/cli/src/x.tsx")).toBe("tsx");
    expect(languageOf("README.md")).toBe("markdown");
    expect(languageOf("Makefile")).toBe("plaintext");
  });
});

describe("splitLines", () => {
  it("a token across a newline becomes a span per line, keeping its class", () => {
    expect(splitLines([{ className: "string", value: "`a\nb`" }, { value: " x" }])).toEqual([
      [{ className: "string", value: "`a" }],
      [{ className: "string", value: "b`" }, { value: " x" }],
    ]);
  });
});

describe("highlightHunk", () => {
  const hunk = {
    file: "src/a.ts",
    lines: [
      { kind: " " as const, text: "const a = 1" },
      { kind: "-" as const, text: "let b = 2" },
      { kind: "+" as const, text: "const b = 3" },
    ],
  };
  const lines = highlightHunk(hunk);

  it("one line of spans per diff line, text preserved", () => {
    expect(lines.map((l) => l.map((s) => s.value).join(""))).toEqual(hunk.lines.map((l) => l.text));
  });

  it("each side is coloured as code: the removed line from the old, the added from the new", () => {
    expect(lines[1]![0]).toEqual({ className: "keyword", value: "let" });
    expect(lines[2]![0]).toEqual({ className: "keyword", value: "const" });
  });

  it("a string opened on one line colours the next", () => {
    const multi = highlightHunk({ file: "a.ts", lines: [{ kind: "+", text: "const s = `one" }, { kind: "+", text: "two`" }] });
    expect(multi[1]![0]).toEqual({ className: "string", value: "two`" });
  });
});
