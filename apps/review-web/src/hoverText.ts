export type Block = { readonly code: string; readonly lang: string } | { readonly text: string } | { readonly label: string };

/** A code fence as the page shows it: PHP's servers open theirs with
 *  `<?php` and give a declaration an empty `{ }` body — neither says
 *  anything the signature does not. */
const tidy = (code: string, lang: string): string =>
  lang === "php" ? code.replace(/^<\?php\s*\n/, "").replace(/\s*\{\s*\}[ \t]*$/gm, "") : code;

/** A hover's markdown, as blocks: the code fences the language server sends
 *  (the signature), the prose around them (the doc comment), and a bold
 *  name heading the whole (`__App\\Exporter::lines__`, PHP's) as a label.
 *  Nothing is set as HTML — fences become coloured lines, prose stays text. */
export function blocks(markdown: string): Array<Block> {
  const out: Array<Block> = [];
  const prose = (text: string) => {
    const t = text.trim();
    if (!t) return;
    // a heading that names the symbol: the first paragraph, bold and alone
    const head = out.length === 0 ? /^__([^\n]+?)__(?:\n\s*\n|$)/.exec(t) : null;
    if (head) {
      out.push({ label: unescape(head[1]!) });
      prose(t.slice(head[0].length));
    } else out.push({ text: t });
  };
  // a fence's info string may carry more than the language ("ts import.meta.vitest")
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let at = 0;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    prose(markdown.slice(at, m.index));
    const lang = m[1]!.trim().split(/\s+/)[0] || "typescript";
    out.push({ code: tidy(m[2]!.replace(/\n$/, ""), lang), lang });
    at = m.index + m[0].length;
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
    .filter((p) => p.length > 0)
    .map((p): Inline => {
      if (p.length > 1 && p.startsWith("`") && p.endsWith("`")) return { code: p.slice(1, -1) };
      if (p.length > 4 && ((p.startsWith("**") && p.endsWith("**")) || (p.startsWith("__") && p.endsWith("__")))) return { strong: unescape(p.slice(2, -2)) };
      return { text: unescape(p.replace(/(^|[\s(])[*_](@?\w[\w-]*)[*_](?=[\s).,:;]|$)/g, "$1$2")) };
    });
}

/** What a hover shows: the signature, then the doc comment's first
 *  paragraph — a library's doc can run to pages of examples, and the
 *  declaration with its whole comment is one click away (peek). */
export function brief(markdown: string): { readonly blocks: ReadonlyArray<Block>; readonly more: boolean; readonly overloads: number } {
  const all = blocks(markdown);
  const label = all.find((b) => "label" in b);
  const fence = all.find((b) => "code" in b) as { code: string; lang: string } | undefined;
  // an overloaded function's signatures arrive in one fence; the first says enough
  const sigs = fence ? signatures(fence.code) : [];
  const code = fence ? { ...fence, code: sigs[0] ?? fence.code } : undefined;
  const firstText = all.find((b) => "text" in b) as { text: string } | undefined;
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
  return out.map((l) => l.join("\n"));
}
