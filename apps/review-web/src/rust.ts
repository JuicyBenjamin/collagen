import { defineLanguage, type HighlightTokenClass, type TokenRange } from "@tanstack/highlight/core";

// Rust, for TanStack Highlight — which has no Rust of its own, and keeps the
// regex helper its grammars are built with internal. So a scanner of our
// own, one pass left to right: what a pattern list gets wrong in Rust is
// exactly what decides the colour of everything after it — a lifetime read
// as a char literal, a raw string's `"#`, a block comment inside a block
// comment. Ready to offer upstream, and to drop when TanStack ships one.

const KEYWORDS = new Set(
  "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type union unsafe use where while yield macro_rules".split(" "),
);
const LITERALS = new Set(["true", "false"]);
const PRIMITIVES = new Set("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str".split(" "));

const identStart = (character: string | undefined): boolean => character !== undefined && /[\p{L}_]/u.test(character);
const identPart = (character: string | undefined): boolean => character !== undefined && /[\p{L}\p{N}_]/u.test(character);

/** The end of a `"…"` string body that starts at `at` (just after the quote). */
const stringEnd = (code: string, at: number): number => {
  while (at < code.length) {
    if (code[at] === "\\") at += 2;
    else if (code[at] === '"') return at + 1;
    else at++;
  }
  return code.length;
};

/** The end of a block comment starting at `at` (on its `/*`): they nest. */
const blockCommentEnd = (code: string, at: number): number => {
  let depth = 0;
  while (at < code.length) {
    if (code.startsWith("/*", at)) {
      depth++;
      at += 2;
    } else if (code.startsWith("*/", at)) {
      depth--;
      at += 2;
      if (depth === 0) return at;
    } else at++;
  }
  return code.length;
};

/** A raw string at `at` (`r"…"`, `r#"…"#`, with a b or c before it): its end,
 *  or -1 when it is not one. */
const rawStringEnd = (code: string, at: number): number => {
  let scan = at;
  if (code[scan] === "b" || code[scan] === "c") scan++;
  if (code[scan] !== "r") return -1;
  scan++;
  let hashes = 0;
  while (code[scan] === "#") {
    hashes++;
    scan++;
  }
  if (code[scan] !== '"') return -1;
  const close = `"${"#".repeat(hashes)}`;
  const end = code.indexOf(close, scan + 1);
  return end < 0 ? code.length : end + close.length;
};

/** A char literal at `at` (on its `'`): its end, or -1 when the quote opens a
 *  lifetime or a label instead (`'a`, `'static`, `'outer:`). */
const charEnd = (code: string, at: number): number => {
  if (code[at + 1] === "\\") {
    const end = code.indexOf("'", at + 3);
    return end < 0 || end - at > 12 ? -1 : end + 1;
  }
  const codePoint = code.codePointAt(at + 1);
  if (codePoint === undefined || code[at + 1] === "\n") return -1;
  const after = at + 1 + (codePoint > 0xffff ? 2 : 1);
  return code[after] === "'" ? after + 1 : -1;
};

/** The end of an attribute, `#[…]` or `#![…]`, starting at `at`: brackets
 *  matched, strings inside skipped. */
const attributeEnd = (code: string, at: number): number => {
  let scan = code.indexOf("[", at) + 1;
  let depth = 1;
  while (scan < code.length && depth > 0) {
    const character = code[scan]!;
    if (character === '"') scan = stringEnd(code, scan + 1);
    else {
      if (character === "[") depth++;
      else if (character === "]") depth--;
      scan++;
    }
  }
  return scan;
};

const NUMBER = /^(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.(?![.\p{L}_])[\d_]*)?(?:[eE][+-]?[\d_]+)?)(?:[iu](?:8|16|32|64|128|size)|f32|f64)?/u;
const OPERATOR = /^(?:<<=|>>=|\.\.=|\.\.\.|\.\.|::|->|=>|==|!=|<=|>=|&&|\|\||[+\-*/%^&|]=|<<|>>|[+\-*/%^!&|=<>?])/;

/** Rust's tokens as ranges, in order and never overlapping. */
export function tokenizeRust(code: string): Array<TokenRange> {
  const out: Array<TokenRange> = [];
  const push = (className: HighlightTokenClass, start: number, end: number) => {
    if (end > start) out.push({ className, start, end });
  };
  // the previous word, to colour what a keyword introduces (fn name, struct Name)
  let prevWord = "";
  let at = 0;
  while (at < code.length) {
    const character = code[at]!;
    const rest = (length: number) => code.slice(at, at + length);
    if (/\s/.test(character)) {
      at++;
      continue;
    }
    if (rest(2) === "//") {
      const newline = code.indexOf("\n", at);
      const end = newline < 0 ? code.length : newline;
      push("comment", at, end);
      at = end;
      continue;
    }
    if (rest(2) === "/*") {
      const end = blockCommentEnd(code, at);
      push("comment", at, end);
      at = end;
      continue;
    }
    if (character === "#" && (code[at + 1] === "[" || (code[at + 1] === "!" && code[at + 2] === "["))) {
      const end = attributeEnd(code, at);
      push("meta", at, end);
      at = end;
      continue;
    }
    // b"…", c"…", r"…", br#"…"#, b'x'
    if (character === "b" || character === "c" || character === "r") {
      const raw = rawStringEnd(code, at);
      if (raw > 0) {
        push("string", at, raw);
        at = raw;
        prevWord = "";
        continue;
      }
      if (code[at + 1] === '"' && character !== "r") {
        const end = stringEnd(code, at + 2);
        push("string", at, end);
        at = end;
        prevWord = "";
        continue;
      }
      if (character === "b" && code[at + 1] === "'") {
        const end = charEnd(code, at + 1);
        if (end > 0) {
          push("string", at, end);
          at = end;
          prevWord = "";
          continue;
        }
      }
    }
    if (character === '"') {
      const end = stringEnd(code, at + 1);
      push("string", at, end);
      at = end;
      prevWord = "";
      continue;
    }
    if (character === "'") {
      const end = charEnd(code, at);
      if (end > 0) {
        push("string", at, end);
        at = end;
      } else {
        // a lifetime or a label
        let scan = at + 1;
        while (identPart(code[scan])) scan++;
        push("type", at, scan);
        at = scan > at + 1 ? scan : at + 1;
      }
      prevWord = "";
      continue;
    }
    if (/\d/.test(character)) {
      const digits = NUMBER.exec(code.slice(at, at + 80))!;
      push("number", at, at + digits[0].length);
      at += digits[0].length;
      prevWord = "";
      continue;
    }
    if (identStart(character) || (character === "r" && code[at + 1] === "#" && identStart(code[at + 2]))) {
      let scan = character === "r" && code[at + 1] === "#" ? at + 2 : at;
      while (identPart(code[scan])) scan++;
      const word = code.slice(at, scan);
      let after = scan;
      while (after < code.length && /\s/.test(code[after]!)) after++;
      if (code[scan] === "!" && code[scan + 1] !== "=") {
        // a macro: its name and its bang
        push(word === "macro_rules" ? "keyword" : "function", at, scan + 1);
        at = scan + 1;
        prevWord = word;
        continue;
      }
      if (KEYWORDS.has(word) && !word.startsWith("r#")) push("keyword", at, scan);
      else if (LITERALS.has(word)) push("literal", at, scan);
      else if (PRIMITIVES.has(word)) push("type", at, scan);
      else if (prevWord === "fn") push("function", at, scan);
      else if (/^[A-Z]/.test(word.replace(/^r#/, ""))) push("type", at, scan);
      else if (code[after] === "(" || code.startsWith("::<", scan)) push("function", at, scan);
      else if (code[at - 1] === "." && code[at - 2] !== ".") push("property", at, scan);
      at = scan;
      prevWord = word;
      continue;
    }
    prevWord = "";
    const operator = OPERATOR.exec(code.slice(at, at + 3));
    if (operator) {
      push("operator", at, at + operator[0].length);
      at += operator[0].length;
      continue;
    }
    at++;
  }
  return out;
}

export const rust = defineLanguage({ name: "rust", aliases: ["rs"], tokenize: (code) => tokenizeRust(code) });
