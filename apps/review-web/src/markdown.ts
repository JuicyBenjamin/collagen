import { nameToEmoji } from "gemoji";
import { Lexer, type Token, type Tokens } from "marked";
import { fenceLanguage, type Language } from "./highlight";

// A comment's words as GitHub-flavoured markdown, read into a small tree of
// the page's own: the page renders each node as an element of its own and
// never sets HTML, so what a stranger wrote cannot run. Of a comment's raw
// HTML, the few tags GitHub shows as formatting (b, i, sub, sup, br, a,
// details and summary) become the page's own nodes; layout tags give way to
// their words; anything else stays text. An image shows only from https
// (else its words), and a link goes only to http(s) or mail.

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong" | "em" | "del" | "sub" | "sup"; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly href: string; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: "image"; readonly src: string; readonly alt: string }
  | { readonly kind: "br" };

export interface Item {
  readonly checked?: boolean;
  readonly blocks: ReadonlyArray<Block>;
}

export type Block =
  | { readonly kind: "p"; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: "heading"; readonly depth: number; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: "code"; readonly lang: Language; readonly text: string }
  | { readonly kind: "quote"; readonly blocks: ReadonlyArray<Block> }
  | { readonly kind: "list"; readonly start: number | undefined; readonly items: ReadonlyArray<Item> }
  | { readonly kind: "table"; readonly head: ReadonlyArray<ReadonlyArray<Inline>>; readonly rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<Inline>>> }
  | { readonly kind: "hr" }
  | { readonly kind: "details"; readonly open: boolean; readonly summary: ReadonlyArray<Inline>; readonly blocks: ReadonlyArray<Block> }
  | { readonly kind: "fields"; readonly fields: ReadonlyArray<{ readonly name: string; readonly value: string }> };

/** `:tada:` as 🎉, as GitHub writes them; a name nobody knows stays as typed. */
export const emojify = (text: string): string => text.replace(/:([a-z0-9_+-]+):/g, (whole, name: string) => nameToEmoji[name] ?? whole);

const safeHref = (href: string): string | undefined => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined);
/** An image is fetched by the page itself: https only, never data: or a plain http one. */
const safeSrc = (src: string): string | undefined => (/^https:/i.test(src.trim()) ? src.trim() : undefined);

const text = (content: string): Inline => ({ kind: "text", text: content });

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** `&amp;` as `&`, `&#128512;` as 😀 — as a browser would read them. */
const decode = (source: string): string =>
  source.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity: string) => {
    if (!entity.startsWith("#")) return ENTITIES[entity] ?? whole;
    const codePoint = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
  });

/** Words a person wrote: entities read, shortcodes as emoji. */
const words = (source: string): Inline => text(emojify(decode(source)));

/** An HTML comment: GitHub never shows one, and bots fill comments with them. */
const hidden = (token: Token): boolean => token.type === "html" && token.raw.trim().startsWith("<!--");

/** The tags GitHub shows as formatting, as the page's own node. */
const FORMATS: Readonly<Record<string, "strong" | "em" | "del" | "sub" | "sup">> = { b: "strong", strong: "strong", i: "em", em: "em", s: "del", del: "del", strike: "del", sub: "sub", sup: "sup" };
/** Tags that only lay out: gone, their words kept. */
const LAYOUT = new Set(["details", "summary", "p", "div", "span", "kbd", "ins", "picture", "source"]);

/** An inline HTML token as a tag: closing or not, its name, its attributes. */
const tagOf = (token: Token): { readonly closing: boolean; readonly name: string; readonly attributes: string } | null => {
  if (token.type !== "html") return null;
  const tag = /^<(\/?)([a-z][a-z0-9]*)\b([^>]*?)\/?>$/i.exec(token.raw.trim());
  return tag ? { closing: tag[1] === "/", name: tag[2]!.toLowerCase(), attributes: tag[3] ?? "" } : null;
};

/** Where the tag opened at `start` closes, counting the same tag nested; -1 when it never does. */
const closingOf = (tokens: ReadonlyArray<Token>, start: number, name: string): number => {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const tag = tagOf(tokens[index]!);
    if (tag?.name !== name) continue;
    depth += tag.closing ? -1 : 1;
    if (depth === 0) return index;
  }
  return -1;
};

const inline = (tokens: ReadonlyArray<Token> | undefined, raw = ""): ReadonlyArray<Inline> => {
  if (!tokens) return raw ? [words(raw)] : [];
  const nodes: Array<Inline> = [];
  for (let index = 0; index < tokens.length; index++) {
    const tag = tagOf(tokens[index]!);
    if (tag?.name === "br") {
      nodes.push({ kind: "br" });
      continue;
    }
    const format = tag ? FORMATS[tag.name] : undefined;
    if (tag && !tag.closing && (format || tag.name === "a")) {
      const end = closingOf(tokens, index, tag.name);
      if (end > index) {
        const children = inline(tokens.slice(index + 1, end));
        const href = tag.name === "a" ? safeHref(/\bhref\s*=\s*"([^"]*)"/i.exec(tag.attributes)?.[1] ?? "") : undefined;
        if (format) nodes.push({ kind: format, children });
        else if (href) nodes.push({ kind: "link", href, children });
        else nodes.push(...children);
        index = end;
        continue;
      }
    }
    if (tag && LAYOUT.has(tag.name)) continue;
    nodes.push(...one(tokens[index]!));
  }
  return nodes;
};

/** One inline token that is not a tag `inline` reads itself. */
const one = (token: Token): ReadonlyArray<Inline> => {
  switch (token.type) {
    case "strong":
    case "em":
    case "del":
      return [{ kind: token.type, children: inline((token as Tokens.Strong).tokens) }];
    case "codespan":
      return [{ kind: "code", text: (token as Tokens.Codespan).text }];
    case "br":
      return [{ kind: "br" }];
    case "link": {
      const link = token as Tokens.Link;
      const href = safeHref(link.href);
      return href ? [{ kind: "link", href, children: inline(link.tokens, link.text) }] : inline(link.tokens, link.text);
    }
    case "image": {
      const image = token as Tokens.Image;
      const src = safeSrc(image.href);
      return src ? [{ kind: "image", src, alt: emojify(decode(image.text)) }] : [words(image.text || image.href)];
    }
    case "escape":
      return [text((token as Tokens.Escape).text)];
    case "html":
      return hidden(token) ? [] : [text(token.raw)];
    default: {
      const nested = (token as Tokens.Text).tokens;
      return nested ? inline(nested) : [words(token.raw)];
    }
  }
};

const LEXING = { gfm: true, breaks: true } as const;

const blocks = (tokens: ReadonlyArray<Token>): ReadonlyArray<Block> =>
  tokens.flatMap((token): ReadonlyArray<Block> => {
    switch (token.type) {
      case "space":
      case "def": // a link's target, already in the link
      case "checkbox": // a task item's [ ]: the item says it
        return [];
      case "paragraph":
      case "text":
        return [{ kind: "p", children: inline((token as Tokens.Paragraph).tokens, token.raw.trim()) }];
      case "heading":
        return [{ kind: "heading", depth: (token as Tokens.Heading).depth, children: inline((token as Tokens.Heading).tokens) }];
      case "code":
        return [{ kind: "code", lang: fenceLanguage((token as Tokens.Code).lang?.trim().split(/\s+/)[0] ?? ""), text: (token as Tokens.Code).text }];
      case "blockquote":
        return [{ kind: "quote", blocks: blocks((token as Tokens.Blockquote).tokens) }];
      case "list": {
        const list = token as Tokens.List;
        return [
          {
            kind: "list",
            start: list.ordered ? (list.start === "" ? 1 : list.start) : undefined,
            items: list.items.map((item) => ({ ...(item.task ? { checked: !!item.checked } : {}), blocks: blocks(item.tokens) })),
          },
        ];
      }
      case "table": {
        const table = token as Tokens.Table;
        return [{ kind: "table", head: table.header.map((cell) => inline(cell.tokens)), rows: table.rows.map((row) => row.map((cell) => inline(cell.tokens))) }];
      }
      case "hr":
        return [{ kind: "hr" }];
      case "html": {
        // a block of raw HTML: read as a line of its own, its formatting tags as formatting
        if (hidden(token)) return [];
        const children = inline(Lexer.lexInline(token.raw.trim(), LEXING));
        return children.length ? [{ kind: "p", children }] : [];
      }
      default: {
        // anything unknown: the words as written, line by line, never as markup
        const lines = token.raw.trim().split("\n").filter((line) => line.trim());
        return lines.length ? [{ kind: "p", children: lines.flatMap((line, index): ReadonlyArray<Inline> => (index ? [{ kind: "br" }, text(line)] : [text(line)])) }] : [];
      }
    }
  });

/** A comment's words as blocks. Single newlines are line breaks, as in a
 *  GitHub comment. A `<details>` fold is one block: its summary, and what
 *  it folds read again as markdown; open only when it says so. */
export const parseMarkdown = (source: string): ReadonlyArray<Block> => {
  const lines = source.split("\n");
  const made: Array<Block> = [];
  let plain: Array<string> = [];
  const flush = () => {
    if (plain.some((line) => line.trim())) made.push(...blocks(new Lexer(LEXING).lex(plain.join("\n"))));
    plain = [];
  };
  let fenced = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const opening = fenced ? null : /^\s*<details(\s[^>]*)?>/i.exec(line);
    // the fold runs to its own closing tag, counting folds inside it
    let end = index;
    for (let depth = 0; opening && end < lines.length; end++) {
      depth += (lines[end]!.match(/<details\b/gi)?.length ?? 0) - (lines[end]!.match(/<\/details>/gi)?.length ?? 0);
      if (depth <= 0) break;
    }
    if (!opening || end >= lines.length) {
      plain.push(line); // not a fold, or one never closed: as written
      continue;
    }
    flush();
    const body = lines.slice(index, end + 1).join("\n").replace(/^\s*<details[^>]*>/i, "").replace(/<\/details>\s*$/i, "");
    const summary = /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(body);
    made.push({
      kind: "details",
      open: /\bopen\b/i.test(opening[1] ?? ""),
      summary: summary ? inline(Lexer.lexInline(summary[1]!.trim(), LEXING)) : [text("Details")],
      blocks: parseMarkdown(summary ? body.slice(summary[0].length) : body),
    });
    index = end;
  }
  flush();
  return made;
};

/** One top-level block of a Markdown file and the lines it spans (1-based,
 *  both ends in), so a diff's lines can be laid on what they made. */
export interface Section {
  readonly blocks: ReadonlyArray<Block>;
  readonly from: number;
  readonly to: number;
}

/** A file's front matter — the `---` block at its very top, as skills and
 *  docs carry — as its fields, and the lines it takes; null when it has none.
 *  Plain `name: value` lines; a line that is not one carries on the field
 *  before it, as a folded YAML value does. */
export const frontMatter = (source: string): { readonly fields: ReadonlyArray<{ readonly name: string; readonly value: string }>; readonly lines: number } | null => {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return null;
  const fields: Array<{ name: string; value: string }> = [];
  for (const line of lines.slice(1, end)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (field) fields.push({ name: field[1]!, value: field[2]!.trim() });
    else if (fields.length > 0 && line.trim()) fields.at(-1)!.value = `${fields.at(-1)!.value} ${line.trim()}`.trim();
  }
  const unquoted = fields.map((field) => ({ name: field.name, value: field.value.replace(/^[>|][-+]?\s*/, "").replace(/^(["'])(.*)\1$/, "$2") }));
  return { fields: unquoted, lines: end + 1 };
};

/** A Markdown file as blocks, each with its lines. A single newline is a
 *  space here, as in a file and unlike a comment. Front matter is its
 *  fields, never a rule and a heading. */
export const parseDocument = (source: string): ReadonlyArray<Section> => {
  const front = frontMatter(source);
  const head: ReadonlyArray<Section> = front ? [{ blocks: [{ kind: "fields", fields: front.fields }], from: 1, to: front.lines }] : [];
  const body = front ? source.split("\n").slice(front.lines).join("\n") : source;
  return [...head, ...parseBody(body, front ? front.lines + 1 : 1)];
};

const parseBody = (source: string, first: number): ReadonlyArray<Section> => {
  let line = first;
  return new Lexer({ gfm: true }).lex(source).flatMap((token): ReadonlyArray<Section> => {
    const from = line;
    const breaks = token.raw.split("\n").length - 1;
    line += breaks;
    const made = blocks([token]);
    // a block's raw text can carry the blank lines after it
    return made.length > 0 ? [{ blocks: made, from, to: from + token.raw.replace(/\n+$/, "").split("\n").length - 1 }] : [];
  });
};
