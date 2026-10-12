import { describe, expect, it } from "vitest";
import { answerParts, selectionLabel } from "./chatText";

describe("answerParts", () => {
  it("draws fenced code as code, the rest as text", () => {
    expect(answerParts("It adds one:\n```ts\nconst a = 1;\n```\nThat's all.")).toEqual([
      { kind: "text", text: "It adds one:" },
      { kind: "code", lang: "ts", text: "const a = 1;" },
      { kind: "text", text: "That's all." },
    ]);
  });

  it("keeps a fence still being written as code so far", () => {
    expect(answerParts("Like so:\n```\nfoo(\n  1")).toEqual([
      { kind: "text", text: "Like so:" },
      { kind: "code", lang: "", text: "foo(\n  1" },
    ]);
  });

  it("is plain text without fences", () => {
    expect(answerParts("just words")).toEqual([{ kind: "text", text: "just words" }]);
  });
});

describe("selectionLabel", () => {
  it("names one line or a block", () => {
    expect(selectionLabel({ file: "a.ts", from: { line: 3 }, to: { line: 3 } })).toBe("a.ts:3");
    expect(selectionLabel({ file: "a.ts", from: { line: 3 }, to: { line: 9 } })).toBe("a.ts:3–9");
  });
});
