import { describe, expect, it } from "vitest";
import { final } from "./data";
import { blocks, brief, inline, signatures } from "./hoverText";

describe("hover markdown", () => {
  const markdown = "```typescript\nconst fn: (name: string) => Traced\n```\nCreates a traced function from an [gen](file:///x#1) body.\n\nMore details.\n\n```ts import.meta.vitest\nconst f = 1\n```";
  it("splits fences from prose, an info string past the language included", () => {
    expect(blocks(markdown).map((block) => ("code" in block ? `code:${block.lang}` : "text"))).toEqual(["code:ts", "text", "code:ts"]);
  });
  it("a brief is the signature and the first paragraph, and says there is more", () => {
    const summary = brief(markdown);
    expect(summary.blocks).toEqual([{ code: "const fn: (name: string) => Traced", lang: "ts" }, { text: "Creates a traced function from an [gen](file:///x#1) body." }]);
    expect(summary.more).toBe(true);
    expect(brief("```typescript\nconst a: number\n```\n").more).toBe(false);
  });
});

describe("a PHP hover (Intelephense)", () => {
  const markdown =
    "__App\\\\Exporter::lines__\n\nThe export as lines, one per row.\n\n```php\n<?php\npublic function lines(int $limit = 100): Collection { }\n```\n\n_@param_ `int $limit`\n\n_@return_ `\\Illuminate\\Support\\Collection`";
  it("names the symbol, then its signature without the <?php and the empty body, then its doc", () => {
    expect(brief(markdown).blocks).toEqual([
      { label: "App\\Exporter::lines" },
      { code: "public function lines(int $limit = 100): Collection", lang: "php" },
      { text: "The export as lines, one per row." },
    ]);
    expect(brief(markdown).more).toBe(true);
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

describe("a Rust hover (rust-analyzer)", () => {
  // as rust-analyzer sends it: module, impl header, where clause, generics
  const hover = "```rust\ncore::option::Option\n```\n\n```rust\nimpl<T> Option<T>\npub const fn map<U, F>(self, f: F) -> Option<U>\nwhere\n    F: FnOnce(T) -> U,\n```\n\n---\n\n`T` = `i32`, `U` = `…`\n\n---\n\nMaps an `Option<T>`.\n\nAt length.";
  it("names the module, then the whole item, impl header and where clause included, then its doc", () => {
    expect(brief(hover).blocks).toEqual([
      { label: "core::option::Option" },
      { code: "impl<T> Option<T>\npub const fn map<U, F>(self, f: F) -> Option<U>\nwhere\n    F: FnOnce(T) -> U,", lang: "rust" },
      { text: "Maps an `Option<T>`." },
    ]);
    expect(brief(hover).overloads).toBe(0);
  });
  it("a hover of one fence keeps it as the code", () => {
    expect(brief("```rust\ni32\n```").blocks).toEqual([{ code: "i32", lang: "rust" }]);
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
  it("a final answer is kept; one given mid-index, missing or failed is asked again", () => {
    expect(final({ markdown: "x" })).toBe(true);
    expect(final({ none: true })).toBe(true);
    expect(final({ peeks: [] })).toBe(true);
    expect(final({ none: true, partial: true, progress: 40 })).toBe(false);
    expect(final({ markdown: "x", partial: true })).toBe(false);
    expect(final({ missing: true })).toBe(false);
    expect(final({ error: "the server exited" })).toBe(false);
  });
});
