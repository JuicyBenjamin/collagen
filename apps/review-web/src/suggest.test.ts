import { describe, expect, it } from "vitest";
import { bodyParts, suggestionBlock } from "./suggest";

describe("a suggested change", () => {
  it("is prefilled with the lines it would replace", () => {
    expect(suggestionBlock(["  return n * 100;", "}"])).toBe("```suggestion\n  return n * 100;\n}\n```");
  });

  it("is fenced longer than any backticks in its code", () => {
    expect(suggestionBlock(["const md = '```';"])).toBe("````suggestion\nconst md = '```';\n````");
  });

  it("is told apart from the words around it, in order", () => {
    expect(bodyParts("Use the page size:\n```suggestion\n  return n * PAGE;\n```\nThen it reads.")).toEqual([
      { kind: "text", text: "Use the page size:" },
      { kind: "suggestion", code: "  return n * PAGE;" },
      { kind: "text", text: "Then it reads." },
    ]);
    // an empty suggestion deletes the lines
    expect(bodyParts("```suggestion\n```")).toEqual([{ kind: "suggestion", code: "" }]);
  });

  it("a fence that never closes, or another language's, is just text", () => {
    expect(bodyParts("```suggestion\nx")).toEqual([{ kind: "text", text: "```suggestion\nx" }]);
    expect(bodyParts("```ts\nx\n```")).toEqual([{ kind: "text", text: "```ts\nx\n```" }]);
  });
});
