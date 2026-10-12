import { describe, expect, it } from "vitest";
import { highlightCode, languageOf } from "./highlight";

/** Each coloured piece of one line of Rust, as [class, text]. */
const pieces = (code: string) =>
  highlightCode(code, "rust")
    .flat()
    .filter((s) => s.className)
    .map((s) => [s.className, s.value]);

describe("Rust", () => {
  it("is what a .rs file is coloured as", () => {
    expect(languageOf("src/main.rs")).toBe("rust");
  });

  it("a lifetime is not a char literal, and the code after it keeps its colours", () => {
    expect(pieces("fn get<'a>(x: &'a str) -> char { 'x' }")).toEqual([
      ["keyword", "fn"],
      ["function", "get"],
      ["operator", "<"],
      ["type", "'a"],
      ["operator", ">"],
      ["operator", "&"],
      ["type", "'a"],
      ["type", "str"],
      ["operator", "->"],
      ["type", "char"],
      ["string", "'x'"],
    ]);
    expect(pieces("let c = '\\''; let s: &'static str = \"\";")).toContainEqual(["string", "'\\''"]);
    expect(pieces("let s: &'static str")).toContainEqual(["type", "'static"]);
    expect(pieces("'outer: loop { break 'outer; }")).toEqual([
      ["type", "'outer"],
      ["keyword", "loop"],
      ["keyword", "break"],
      ["type", "'outer"],
    ]);
  });

  it("a raw string runs to its own closing hashes", () => {
    expect(pieces('let s = r#"say "hi" // not a comment"#; let n = 1;')).toEqual([
      ["keyword", "let"],
      ["operator", "="],
      ["string", 'r#"say "hi" // not a comment"#'],
      ["keyword", "let"],
      ["operator", "="],
      ["number", "1"],
    ]);
    expect(pieces('b"bytes" br"raw" c"text" b\'x\'').map(([c]) => c)).toEqual(["string", "string", "string", "string"]);
  });

  it("block comments nest", () => {
    expect(pieces("/* a /* b */ still */ fn f() {}")).toEqual([
      ["comment", "/* a /* b */ still */"],
      ["keyword", "fn"],
      ["function", "f"],
    ]);
  });

  it("attributes and macros are their own colour; a bang before = is not a macro", () => {
    expect(pieces('#[derive(Debug, Clone)] #![allow(dead_code)] println!("{}", a != b);')).toEqual([
      ["meta", "#[derive(Debug, Clone)]"],
      ["meta", "#![allow(dead_code)]"],
      ["function", "println!"],
      ["string", '"{}"'],
      ["operator", "!="],
    ]);
    expect(pieces('#[cfg(feature = "]")] fn x() {}')[0]).toEqual(["meta", '#[cfg(feature = "]")]']);
  });

  it("paths, calls and turbofish: types by their capital, functions by their call", () => {
    expect(pieces("std::collections::HashMap::new().iter().collect::<Vec<_>>()")).toEqual([
      ["operator", "::"],
      ["operator", "::"],
      ["type", "HashMap"],
      ["operator", "::"],
      ["function", "new"],
      ["function", "iter"],
      ["function", "collect"],
      ["operator", "::"],
      ["operator", "<"],
      ["type", "Vec"],
      ["operator", "<"],
      ["operator", ">>"],
    ]);
    expect(pieces("self.len")).toEqual([
      ["keyword", "self"],
      ["property", "len"],
    ]);
  });

  it("numbers with their suffixes; a range is not a float", () => {
    expect(pieces("0..10u8")).toEqual([
      ["number", "0"],
      ["operator", ".."],
      ["number", "10u8"],
    ]);
    expect(pieces("1_000.5e-3f64 0xFF_u32")).toEqual([
      ["number", "1_000.5e-3f64"],
      ["number", "0xFF_u32"],
    ]);
  });

  it("a doc comment and a string across lines colour every line", () => {
    const lines = highlightCode('/// Docs\nlet s = "one\ntwo";', "rust");
    expect(lines[0]).toEqual([{ className: "comment", value: "/// Docs" }]);
    expect(lines[2]![0]).toEqual({ className: "string", value: 'two"' });
  });
});
