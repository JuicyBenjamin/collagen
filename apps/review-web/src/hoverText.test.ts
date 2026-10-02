import { describe, expect, it } from "vitest";
import { blocks, brief, signatures } from "./hoverText";

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

describe("signatures", () => {
  it("splits overloads, keeping each one's closing line with it", () => {
    const code = "(alias) function Show<T>(props: {\n    when: T;\n}): Element\n(alias) function Show<T, F>(props: {\n    keyed: true;\n}): Element";
    expect(signatures(code)).toHaveLength(2);
    expect(signatures(code)[0]!.endsWith("}): Element")).toBe(true);
    expect(brief("```typescript\n" + code + "\n```").overloads).toBe(1);
  });
});
