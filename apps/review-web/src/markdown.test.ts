import { describe, expect, it } from "vitest";
import { emojify, parseMarkdown } from "./markdown";

describe("a comment as markdown", () => {
  it("turns emoji shortcodes into emoji, and leaves unknown names and code alone", () => {
    expect(emojify("nice :tada: and :+1: but :nope:")).toBe("nice 🎉 and 👍 but :nope:");
    expect(parseMarkdown("`:tada:`")).toEqual([{ kind: "p", children: [{ kind: "code", text: ":tada:" }] }]);
    expect(parseMarkdown("good :rocket:")).toEqual([{ kind: "p", children: [{ kind: "text", text: "good 🚀" }] }]);
  });

  it("reads formatting, lists, task lists, fences and tables", () => {
    const [p, list, code, table] = parseMarkdown("**bold** and _soft_\n\n- [x] done\n- [ ] not\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(p).toMatchObject({ kind: "p", children: [{ kind: "strong" }, { kind: "text", text: " and " }, { kind: "em" }] });
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
    const [p] = parseMarkdown("[hi](javascript:alert(1)) [ok](https://example.com)");
    expect(p).toMatchObject({ kind: "p", children: [{ kind: "text", text: "hi" }, { kind: "text", text: " " }, { kind: "link", href: "https://example.com" }] });
  });
});
