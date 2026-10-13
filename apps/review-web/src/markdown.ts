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

const text = (t: string): Inline => ({ kind: "text", text: t });

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** `&amp;` as `&`, `&#128512;` as 😀 — as a browser would read them. */
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, e: string) => {
    if (!e.startsWith("#")) return ENTITIES[e] ?? whole;
    const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });

/** Words a person wrote: entities read, shortcodes as emoji. */
const words = (s: string): Inline => text(emojify(decode(s)));

/** An HTML comment: GitHub never shows one, and bots fill comments with them. */
const hidden = (t: Token): boolean => t.type === "html" && t.raw.trim().startsWith("<!--");

const inline = (tokens: ReadonlyArray<Token> | undefined, raw = ""): ReadonlyArray<Inline> => {
  if (!tokens) return raw ? [words(raw)] : [];
  return tokens.flatMap((t): ReadonlyArray<Inline> => {
    switch (t.type) {
      case "strong":
      case "em":
      case "del":
        return [{ kind: t.type, children: inline((t as Tokens.Strong).tokens) }];
      case "codespan":
        return [{ kind: "code", text: (t as Tokens.Codespan).text }];
      case "br":
        return [{ kind: "br" }];
      case "link": {
        const l = t as Tokens.Link;
        const href = safeHref(l.href);
        return href ? [{ kind: "link", href, children: inline(l.tokens, l.text) }] : inline(l.tokens, l.text);
      }
      case "image": {
        const i = t as Tokens.Image;
        const src = safeSrc(i.href);
        return src ? [{ kind: "image", src, alt: emojify(decode(i.text)) }] : [words(i.text || i.href)];
      }
      case "escape":
        return [text((t as Tokens.Escape).text)];
      case "html":
        return hidden(t) ? [] : [text(t.raw)];
      default: {
        const nested = (t as Tokens.Text).tokens;
        return nested ? inline(nested) : [words(t.raw)];
      }
    }
  });
};

const blocks = (tokens: ReadonlyArray<Token>): ReadonlyArray<Block> =>
  tokens.flatMap((t): ReadonlyArray<Block> => {
    switch (t.type) {
      case "space":
      case "def": // a link's target, already in the link
      case "checkbox": // a task item's [ ]: the item says it
        return [];
      case "paragraph":
      case "text":
        return [{ kind: "p", children: inline((t as Tokens.Paragraph).tokens, t.raw.trim()) }];
      case "heading":
        return [{ kind: "heading", depth: (t as Tokens.Heading).depth, children: inline((t as Tokens.Heading).tokens) }];
      case "code":
        return [{ kind: "code", lang: fenceLanguage((t as Tokens.Code).lang?.trim().split(/\s+/)[0] ?? ""), text: (t as Tokens.Code).text }];
      case "blockquote":
        return [{ kind: "quote", blocks: blocks((t as Tokens.Blockquote).tokens) }];
      case "list": {
        const l = t as Tokens.List;
        return [
          {
            kind: "list",
            start: l.ordered ? (l.start === "" ? 1 : l.start) : undefined,
            items: l.items.map((i) => ({ ...(i.task ? { checked: !!i.checked } : {}), blocks: blocks(i.tokens) })),
          },
        ];
      }
      case "table": {
        const tb = t as Tokens.Table;
        return [{ kind: "table", head: tb.header.map((c) => inline(c.tokens)), rows: tb.rows.map((r) => r.map((c) => inline(c.tokens))) }];
      }
      case "hr":
        return [{ kind: "hr" }];
      default: {
        // raw HTML and anything unknown: the words as written, line by line, never as markup
        const lines = hidden(t) ? [] : t.raw.trim().split("\n").filter((l) => l.trim());
        return lines.length ? [{ kind: "p", children: lines.flatMap((l, i): ReadonlyArray<Inline> => (i ? [{ kind: "br" }, text(l)] : [text(l)])) }] : [];
      }
    }
  });

/** A comment's words as blocks. Single newlines are line breaks, as in a
 *  GitHub comment. */
export const parseMarkdown = (source: string): ReadonlyArray<Block> => blocks(new Lexer({ gfm: true, breaks: true }).lex(source));
