import { fenceLanguage, type Language } from "./highlight";

export type Block = { readonly code: string; readonly lang: Language } | { readonly text: string } | { readonly label: string };

/** A code fence as the page shows it: PHP's servers open theirs with
 *  `<?php` and give a declaration an empty `{ }` body — neither says
 *  anything the signature does not. */
const tidy = (code: string, lang: Language): string =>
  lang === "php" ? code.replace(/^<\?php\s*\n/, "").replace(/\s*\{\s*\}[ \t]*$/gm, "") : code;

/** A hover's markdown, as blocks: the code fences the language server sends
 *  (the signature), the prose around them (the doc comment), and a bold
 *  name heading the whole (`__App\\Exporter::lines__`, PHP's) as a label.
 *  Nothing is set as HTML — fences become coloured lines, prose stays text. */
export function blocks(markdown: string): Array<Block> {
  const out: Array<Block> = [];
  const prose = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // a heading that names the symbol: the first paragraph, bold and alone
    const head = out.length === 0 ? /^__([^\n]+?)__(?:\n\s*\n|$)/.exec(trimmed) : null;
    if (head) {
      out.push({ label: unescape(head[1]!) });
      prose(trimmed.slice(head[0].length));
    } else out.push({ text: trimmed });
  };
  // a fence's info string may carry more than the language ("ts import.meta.vitest")
  const fencePattern = /```([^\n]*)\n([\s\S]*?)```/g;
  let at = 0;
  for (let match = fencePattern.exec(markdown); match; match = fencePattern.exec(markdown)) {
    prose(markdown.slice(at, match.index));
    // a fence with no language is the TypeScript server's
    const name = match[1]!.trim().split(/\s+/)[0];
    const lang = name ? fenceLanguage(name) : "ts";
    out.push({ code: tidy(match[2]!.replace(/\n$/, ""), lang), lang });
    at = match.index + match[0].length;
  }
  prose(markdown.slice(at));
  return out;
}

/** Markdown's backslash escapes, undone: `App\\Exporter` is App\Exporter. */
const unescape = (text: string): string => text.replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, "$1");

export type Inline = { readonly code: string } | { readonly strong: string } | { readonly text: string };

/** Prose with the little markdown a doc comment uses: `code`, **strong** or
 *  __strong__, _emphasis_ and *@tags* shown plain, [links](…) and <links>
 *  by their text (they point at files on this machine, or the manual). */
export function inline(text: string): Array<Inline> {
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<(https?:[^>]+)>/g, "$1");
  return plain
    .split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/)
    .filter((part) => part.length > 0)
    .map((part): Inline => {
      if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) return { code: part.slice(1, -1) };
      if (part.length > 4 && ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__")))) return { strong: unescape(part.slice(2, -2)) };
      return { text: unescape(part.replace(/(^|[\s(])[*_](@?\w[\w-]*)[*_](?=[\s).,:;]|$)/g, "$1$2")) };
    });
}

/** What a hover shows: the signature, then the doc comment's first
 *  paragraph — a library's doc can run to pages of examples, and the
 *  declaration with its whole comment is one click away (peek). */
export function brief(markdown: string): { readonly blocks: ReadonlyArray<Block>; readonly more: boolean; readonly overloads: number } {
  const all = blocks(markdown);
  const label = all.find((block) => "label" in block);
  const fence = all.find((block) => "code" in block) as { code: string; lang: Language } | undefined;
  // an overloaded function's signatures arrive in one fence; the first says enough
  const sigs = fence ? signatures(fence.code) : [];
  const code = fence ? { ...fence, code: sigs[0] ?? fence.code } : undefined;
  const firstText = all.find((block) => "text" in block) as { text: string } | undefined;
  const para = firstText?.text.split(/\n\s*\n/)[0]?.trim();
  const out = [...(label ? [label] : []), ...(code ? [code] : []), ...(para ? [{ text: para }] : [])];
  return { blocks: out, more: all.length > out.length || (firstText !== undefined && para !== firstText.text.trim()), overloads: Math.max(0, sigs.length - 1) };
}

/** The signatures in a hover's code: a new one starts on an unindented line
 *  that does not close the one before ("}): Element" belongs to its own). */
export function signatures(code: string): Array<string> {
  const out: Array<Array<string>> = [];
  for (const line of code.split("\n")) {
    const starts = out.length === 0 || (/^\S/.test(line) && !/^[)\]}>]/.test(line));
    if (starts) out.push([line]);
    else out[out.length - 1]!.push(line);
  }
  return out.map((signature) => signature.join("\n"));
}
