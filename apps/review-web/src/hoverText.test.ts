import { describe, expect, it } from "vitest";
import { blocks, brief } from "./hoverText";

describe("hover markdown", () => {
  const md = "```typescript\nconst fn: (name: string) => Traced\n```\nCreates a traced function from an [gen](file:///x#1) body.\n\nMore details.\n\n```ts import.meta.vitest\nconst f = 1\n```";
  it("splits fences from prose, an info string past the language included", () => {
    expect(blocks(md).map((b) => ("code" in b ? `code:${b.lang}` : "text"))).toEqual(["code:typescript", "text", "code:ts"]);
  });
  it("a brief is the signature and the first paragraph, and says there is more", () => {
    const b = brief(md);
    expect(b.blocks).toEqual([{ code: "const fn: (name: string) => Traced", lang: "typescript" }, { text: "Creates a traced function from an [gen](file:///x#1) body." }]);
    expect(b.more).toBe(true);
    expect(brief("```typescript\nconst a: number\n```\n").more).toBe(false);
  });
});
