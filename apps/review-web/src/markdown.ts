import { nameToEmoji } from "gemoji";
import { Lexer, type Token, type Tokens } from "marked";
import { fenceLanguage, type Language } from "./highlight";

// A comment's words as GitHub-flavoured markdown, read into a small tree of
// the page's own: the page renders each node as an element of its own and
// never sets HTML, so what a stranger wrote cannot run. Raw HTML in a comment
// stays text, an image shows only from https (else its words), and a link
// goes only to http(s) or mail.

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong" | "em" | "del"; readonly children: ReadonlyArray<Inline> }
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
  | { readonly kind: "hr" };

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

const inline = (tokens: ReadonlyArray<Token> | undefined, raw = ""): ReadonlyArray<Inline> => {
  if (!tokens) return raw ? [words(raw)] : [];
  return tokens.flatMap((token): ReadonlyArray<Inline> => {
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
  });
};

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
      default: {
        // raw HTML and anything unknown: the words as written, line by line, never as markup
        const lines = hidden(token) ? [] : token.raw.trim().split("\n").filter((line) => line.trim());
        return lines.length ? [{ kind: "p", children: lines.flatMap((line, index): ReadonlyArray<Inline> => (index ? [{ kind: "br" }, text(line)] : [text(line)])) }] : [];
      }
    }
  });

/** A comment's words as blocks. Single newlines are line breaks, as in a
 *  GitHub comment. */
export const parseMarkdown = (source: string): ReadonlyArray<Block> => blocks(new Lexer({ gfm: true, breaks: true }).lex(source));
