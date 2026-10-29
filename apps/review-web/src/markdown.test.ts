import { describe, expect, it } from "vitest";
import { emojify, parseDocument, parseMarkdown } from "./markdown";

describe("a comment as markdown", () => {
  it("turns emoji shortcodes into emoji, and leaves unknown names and code alone", () => {
    expect(emojify("nice :tada: and :+1: but :nope:")).toBe("nice 🎉 and 👍 but :nope:");
    expect(parseMarkdown("`:tada:`")).toEqual([{ kind: "p", children: [{ kind: "code", text: ":tada:" }] }]);
    expect(parseMarkdown("good :rocket:")).toEqual([{ kind: "p", children: [{ kind: "text", text: "good 🚀" }] }]);
  });

  it("reads formatting, lists, task lists, fences and tables", () => {
    const [paragraph, list, code, table] = parseMarkdown("**bold** and _soft_\n\n- [x] done\n- [ ] not\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(paragraph).toMatchObject({ kind: "p", children: [{ kind: "strong" }, { kind: "text", text: " and " }, { kind: "em" }] });
    expect(list).toMatchObject({ kind: "list", items: [{ checked: true }, { checked: false }] });
    expect(code).toEqual({ kind: "code", lang: "ts", text: "const a = 1;" });
    expect(table).toMatchObject({ kind: "table", head: [[{ text: "a" }], [{ text: "b" }]] });
  });

  it("shows what GitHub shows: entities read, and no HTML comments or link definitions", () => {
    expect(parseMarkdown("<!-- bot: state -->\n\nsee [docs][1] &amp; more\n\n[1]: https://example.com")).toEqual([
      { kind: "p", children: [{ kind: "text", text: "see " }, { kind: "link", href: "https://example.com", children: [{ kind: "text", text: "docs" }] }, { kind: "text", text: " & more" }] },
    ]);
  });

  it("never lets a comment's HTML or a script link through", () => {
    const [html] = parseMarkdown("<img src=x onerror=alert(1)>");
    expect(JSON.stringify(html)).not.toMatch(/"kind":"(link|image)"/);
    // an image shows from https only; anything else stays its words
    expect(parseMarkdown("![shot](https://github.com/u/a.png) ![bad](javascript:x) ![old](http://x/a.png)")).toEqual([
      { kind: "p", children: [{ kind: "image", src: "https://github.com/u/a.png", alt: "shot" }, { kind: "text", text: " " }, { kind: "text", text: "bad" }, { kind: "text", text: " " }, { kind: "text", text: "old" }] },
    ]);
    const [paragraph] = parseMarkdown("[hi](javascript:alert(1)) [ok](https://example.com)");
    expect(paragraph).toMatchObject({ kind: "p", children: [{ kind: "text", text: "hi" }, { kind: "text", text: " " }, { kind: "link", href: "https://example.com" }] });
  });
});

describe("a Markdown file, read as a document", () => {
  it("gives each block the lines it spans, so a changed line marks the block it is in", () => {
    const file = ["# Title", "", "First paragraph,", "on two lines.", "", "- one", "- two", "", "```ts", "const a = 1;", "```"].join("\n");
    expect(parseDocument(file).map((section) => [section.blocks[0]!.kind, section.from, section.to])).toEqual([
      ["heading", 1, 1],
      ["p", 3, 4],
      ["list", 6, 7],
      ["code", 9, 11],
    ]);
  });

  it("shows front matter as its fields, never a rule and a heading, and keeps the lines after it in place", () => {
    const file = ["---", "name: editable-field", "description: Building with", "  EditableFieldV2.", "---", "", "# Use", "Body."].join("\n");
    const sections = parseDocument(file);
    expect(sections[0]!.blocks[0]).toEqual({ kind: "fields", fields: [{ name: "name", value: "editable-field" }, { name: "description", value: "Building with EditableFieldV2." }] });
    expect(sections.map((section) => [section.blocks[0]!.kind, section.from, section.to])).toEqual([
      ["fields", 1, 5],
      ["heading", 7, 7],
      ["p", 8, 8],
    ]);
  });
});
