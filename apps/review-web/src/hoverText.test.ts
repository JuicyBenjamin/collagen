import { describe, expect, it } from "vitest";
import { final } from "./data";
import { blocks, brief, inline, signatures } from "./hoverText";

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

describe("a PHP hover (Intelephense)", () => {
  const md =
    "__App\\\\Exporter::lines__\n\nThe export as lines, one per row.\n\n```php\n<?php\npublic function lines(int $limit = 100): Collection { }\n```\n\n_@param_ `int $limit`\n\n_@return_ `\\Illuminate\\Support\\Collection`";
  it("names the symbol, then its signature without the <?php and the empty body, then its doc", () => {
    expect(brief(md).blocks).toEqual([
      { label: "App\\Exporter::lines" },
      { code: "public function lines(int $limit = 100): Collection", lang: "php" },
      { text: "The export as lines, one per row." },
    ]);
    expect(brief(md).more).toBe(true);
  });
  it("its prose reads plain: tags unemphasised, code kept, links by their text", () => {
    expect(inline("_@param_ `int $limit` The length of the _string_ <https://php.net/x>")).toEqual([
      { text: "@param " },
      { code: "int $limit" },
      { text: " The length of the string https://php.net/x" },
    ]);
    expect(inline("**Bold** and __also__")).toEqual([{ strong: "Bold" }, { text: " and " }, { strong: "also" }]);
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

describe("which answers the page keeps", () => {
  it("a final answer is kept; one given mid-index, partial, missing or failed is asked again", () => {
    expect(final({ markdown: "x" })).toBe(true);
    expect(final({ none: true })).toBe(true);
    expect(final({ peeks: [] })).toBe(true);
    expect(final({ indexing: true })).toBe(false);
    expect(final({ markdown: "x", partial: true })).toBe(false);
    expect(final({ missing: true })).toBe(false);
    expect(final({ error: "the server exited" })).toBe(false);
  });
});
