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

const identStart = (c: string | undefined): boolean => c !== undefined && /[\p{L}_]/u.test(c);
const identPart = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

/** The end of a `"…"` string body that starts at `i` (just after the quote). */
const stringEnd = (code: string, i: number): number => {
  while (i < code.length) {
    if (code[i] === "\\") i += 2;
    else if (code[i] === '"') return i + 1;
    else i++;
  }
  return code.length;
};

/** The end of a block comment starting at `i` (on its `/*`): they nest. */
const blockCommentEnd = (code: string, i: number): number => {
  let depth = 0;
  while (i < code.length) {
    if (code.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (code.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else i++;
  }
  return code.length;
};

/** A raw string at `i` (`r"…"`, `r#"…"#`, with a b or c before it): its end,
 *  or -1 when it is not one. */
const rawStringEnd = (code: string, i: number): number => {
  let j = i;
  if (code[j] === "b" || code[j] === "c") j++;
  if (code[j] !== "r") return -1;
  j++;
  let hashes = 0;
  while (code[j] === "#") {
    hashes++;
    j++;
  }
  if (code[j] !== '"') return -1;
  const close = `"${"#".repeat(hashes)}`;
  const end = code.indexOf(close, j + 1);
  return end < 0 ? code.length : end + close.length;
};

/** A char literal at `i` (on its `'`): its end, or -1 when the quote opens a
 *  lifetime or a label instead (`'a`, `'static`, `'outer:`). */
const charEnd = (code: string, i: number): number => {
  if (code[i + 1] === "\\") {
    const end = code.indexOf("'", i + 3);
    return end < 0 || end - i > 12 ? -1 : end + 1;
  }
  const cp = code.codePointAt(i + 1);
  if (cp === undefined || code[i + 1] === "\n") return -1;
  const after = i + 1 + (cp > 0xffff ? 2 : 1);
  return code[after] === "'" ? after + 1 : -1;
};

/** The end of an attribute, `#[…]` or `#![…]`, starting at `i`: brackets
 *  matched, strings inside skipped. */
const attributeEnd = (code: string, i: number): number => {
  let j = code.indexOf("[", i) + 1;
  let depth = 1;
  while (j < code.length && depth > 0) {
    const c = code[j]!;
    if (c === '"') j = stringEnd(code, j + 1);
    else {
      if (c === "[") depth++;
      else if (c === "]") depth--;
      j++;
    }
  }
  return j;
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
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    const rest = (n: number) => code.slice(i, i + n);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (rest(2) === "//") {
      const nl = code.indexOf("\n", i);
      const end = nl < 0 ? code.length : nl;
      push("comment", i, end);
      i = end;
      continue;
    }
    if (rest(2) === "/*") {
      const end = blockCommentEnd(code, i);
      push("comment", i, end);
      i = end;
      continue;
    }
    if (c === "#" && (code[i + 1] === "[" || (code[i + 1] === "!" && code[i + 2] === "["))) {
      const end = attributeEnd(code, i);
      push("meta", i, end);
      i = end;
      continue;
    }
    // b"…", c"…", r"…", br#"…"#, b'x'
    if (c === "b" || c === "c" || c === "r") {
      const raw = rawStringEnd(code, i);
      if (raw > 0) {
        push("string", i, raw);
        i = raw;
        prevWord = "";
        continue;
      }
      if (code[i + 1] === '"' && c !== "r") {
        const end = stringEnd(code, i + 2);
        push("string", i, end);
        i = end;
        prevWord = "";
        continue;
      }
      if (c === "b" && code[i + 1] === "'") {
        const end = charEnd(code, i + 1);
        if (end > 0) {
          push("string", i, end);
          i = end;
          prevWord = "";
          continue;
        }
      }
    }
    if (c === '"') {
      const end = stringEnd(code, i + 1);
      push("string", i, end);
      i = end;
      prevWord = "";
      continue;
    }
    if (c === "'") {
      const end = charEnd(code, i);
      if (end > 0) {
        push("string", i, end);
        i = end;
      } else {
        // a lifetime or a label
        let j = i + 1;
        while (identPart(code[j])) j++;
        push("type", i, j);
        i = j > i + 1 ? j : i + 1;
      }
      prevWord = "";
      continue;
    }
    if (/\d/.test(c)) {
      const m = NUMBER.exec(code.slice(i, i + 80))!;
      push("number", i, i + m[0].length);
      i += m[0].length;
      prevWord = "";
      continue;
    }
    if (identStart(c) || (c === "r" && code[i + 1] === "#" && identStart(code[i + 2]))) {
      let j = c === "r" && code[i + 1] === "#" ? i + 2 : i;
      while (identPart(code[j])) j++;
      const word = code.slice(i, j);
      let after = j;
      while (after < code.length && /\s/.test(code[after]!)) after++;
      if (code[j] === "!" && code[j + 1] !== "=") {
        // a macro: its name and its bang
        push(word === "macro_rules" ? "keyword" : "function", i, j + 1);
        i = j + 1;
        prevWord = word;
        continue;
      }
      if (KEYWORDS.has(word) && !word.startsWith("r#")) push("keyword", i, j);
      else if (LITERALS.has(word)) push("literal", i, j);
      else if (PRIMITIVES.has(word)) push("type", i, j);
      else if (prevWord === "fn") push("function", i, j);
      else if (/^[A-Z]/.test(word.replace(/^r#/, ""))) push("type", i, j);
      else if (code[after] === "(" || code.startsWith("::<", j)) push("function", i, j);
      else if (code[i - 1] === "." && code[i - 2] !== ".") push("property", i, j);
      i = j;
      prevWord = word;
      continue;
    }
    prevWord = "";
    const op = OPERATOR.exec(code.slice(i, i + 3));
    if (op) {
      push("operator", i, i + op[0].length);
      i += op[0].length;
      continue;
    }
    i++;
  }
  return out;
}

export const rust = defineLanguage({ name: "rust", aliases: ["rs"], tokenize: (code) => tokenizeRust(code) });
