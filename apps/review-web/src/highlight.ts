import { createHighlighter, type HighlightToken, type HighlightTokenClass } from "@tanstack/highlight/core";
import { css } from "@tanstack/highlight/languages/css";
import { go } from "@tanstack/highlight/languages/go";
import { html } from "@tanstack/highlight/languages/html";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { jsx } from "@tanstack/highlight/languages/jsx";
import { markdown } from "@tanstack/highlight/languages/markdown";
import { php } from "@tanstack/highlight/languages/php";
import { python } from "@tanstack/highlight/languages/python";
import { shell } from "@tanstack/highlight/languages/shell";
import { sql } from "@tanstack/highlight/languages/sql";
import { toml } from "@tanstack/highlight/languages/toml";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { yaml } from "@tanstack/highlight/languages/yaml";
import type { Hunk } from "./data";

// Syntax colour for a diff, with TanStack Highlight: synchronous, tiny, and
// it hands back TOKENS — so the page renders them as its own spans and never
// sets HTML. Only the languages a code review usually meets are registered;
// anything else is plain text, still a readable diff.

const highlighter = createHighlighter({ languages: [css, go, html, js, json, jsx, markdown, php, python, shell, sql, toml, ts, tsx, yaml] });

const BY_EXT: Record<string, string> = {
  ts: "ts", mts: "ts", cts: "ts", tsx: "tsx",
  js: "js", mjs: "js", cjs: "js", jsx: "jsx",
  json: "json", css: "css", html: "html", htm: "html",
  md: "markdown", markdown: "markdown",
  php: "php", phtml: "php",
  py: "python", go: "go", sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", toml: "toml", yml: "yaml", yaml: "yaml",
};

/** The language a file is highlighted as, from its extension. */
export const languageOf = (file: string): string => BY_EXT[file.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";

export interface Span {
  readonly className?: HighlightTokenClass;
  readonly value: string;
}

/** Tokens cut into lines: a token that spans a newline (a template string, a
 *  block comment) becomes one span per line, each keeping its class. */
export function splitLines(tokens: ReadonlyArray<HighlightToken>): Array<Array<Span>> {
  const lines: Array<Array<Span>> = [[]];
  for (const t of tokens) {
    const parts = t.value.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1]!.push(t.className ? { className: t.className, value: part } : { value: part });
    });
  }
  return lines;
}

/** Every line of a hunk as spans. Each side of the hunk — the old file's
 *  lines (context and removed), the new file's (context and added) — is
 *  tokenized as one block, so a string or a comment that opens on one line
 *  colours the next; each diff line then takes its spans from its side. */
export function highlightHunk(hunk: Pick<Hunk, "file" | "lines">): Array<Array<Span>> {
  const lang = languageOf(hunk.file);
  const side = (keep: (k: string) => boolean) => {
    const picked = hunk.lines.map((l, i) => ({ l, i })).filter(({ l }) => keep(l.kind));
    const spans = splitLines(highlighter.tokenize(picked.map(({ l }) => l.text).join("\n"), { lang }).tokens);
    return new Map(picked.map(({ i }, n) => [i, spans[n] ?? []]));
  };
  const before = side((k) => k !== "+");
  const after = side((k) => k !== "-");
  return hunk.lines.map((l, i) => (l.kind === "-" ? before.get(i) : after.get(i)) ?? [{ value: l.text }]);
}

/** Any code as lines of spans — a peeked declaration, a hover's signature.
 *  `lang` is a file name or a language name (typescript, ts, tsx…). */
export function highlightCode(code: string, lang: string): Array<Array<Span>> {
  const asFile = lang.includes(".") ? languageOf(lang) : lang === "typescript" ? "ts" : lang === "javascript" ? "js" : lang;
  return splitLines(highlighter.tokenize(code, { lang: asFile }).tokens);
}

