import type { DiffLine, Hunk, TestCase, TestFile } from "@collagen/review-web/data";

// A review's tests, read apart from its code. Agents write tests by the
// dozen and readers skip them as "surely right"; in their own tab each one
// leads with its title — what it claims to protect — so the question is
// whether it is worth having, not how it is written. Its code is one step
// away, the whole test as one hunk. Pure: the diff's hunks of a test file
// and the file's text at both ends (services/ReviewView reads those).

/** A test file, by its name or its folder. */
export const isTest = (file: string): boolean => /\.(test|spec)\.[a-z]+$/i.test(file) || /(^|\/)(tests?|__tests__)\//.test(file);

/** A test as its file has it: the describes it sits in, its title, and the
 *  lines it spans (1-based, both ends in). */
export interface Found {
  readonly under: ReadonlyArray<string>;
  readonly title: string;
  readonly start: number;
  readonly end: number;
}

const GROUPS = new Set(["describe", "suite", "context"]);
const TESTS = new Set(["test", "it", "specify"]);
/** what may follow the name before its call: `it.only(`, `test.each([...])(` */
const MODIFIERS = new Set(["only", "skip", "todo", "each", "concurrent", "sequential", "fails", "failing", "runIf", "skipIf", "serial", "parallel"]);

/** The tests in a file's text: calls in the style of Vitest, Jest, Mocha
 *  and Pest (`describe("…", …)`, `it("…", …)`, `test.each(…)("…", …)`),
 *  else named test functions (PHPUnit's `testFoo`, Go's `TestFoo`,
 *  Python's `test_foo`). Code it cannot follow yields fewer tests, never wrong lines. */
export const testsIn = (lines: ReadonlyArray<string>): ReadonlyArray<Found> => scan(lines).tests;

/** The lines a describe spans (1-based, both ends in). */
interface Group {
  readonly start: number;
  readonly end: number;
}

/** The tests, and the describes that frame them. */
function scan(lines: ReadonlyArray<string>): { readonly tests: ReadonlyArray<Found>; readonly groups: ReadonlyArray<Group> } {
  const calls = callTests(lines);
  return calls.tests.length > 0 ? calls : { tests: namedTests(lines), groups: [] };
}

function callTests(lines: ReadonlyArray<string>): { readonly tests: ReadonlyArray<Found>; readonly groups: ReadonlyArray<Group> } {
  const source = lines.join("\n");
  const lineAt: Array<number> = [];
  for (let index = 0, lineNumber = 1; index <= source.length; index++) {
    lineAt.push(lineNumber);
    if (source[index] === "\n") lineNumber++;
  }
  const out: Array<Found> = [];
  const groups: Array<Group> = [];
  const open: Array<{ readonly group: boolean; readonly title: string; readonly start: number; readonly depth: number }> = [];
  let depth = 0;
  let last = ""; // the last significant character, to tell a regex from a division
  const isWord = (char: string | undefined) => char !== undefined && /[\w$]/.test(char);
  const blank = (at: number) => {
    while (at < source.length && /\s/.test(source[at]!)) at++;
    return at;
  };
  /** past the string starting at `at` (its quote there): the end and its text */
  const stringAt = (at: number): { end: number; text: string } => {
    const quote = source[at]!;
    let cursor = at + 1;
    let text = "";
    while (cursor < source.length && source[cursor] !== quote) {
      if (source[cursor] === "\\") {
        text += source[cursor + 1] ?? "";
        cursor += 2;
        continue;
      }
      if (quote === "`" && source[cursor] === "$" && source[cursor + 1] === "{") {
        // an interpolation: kept as written, its braces followed
        let braces = 0;
        const from = cursor;
        for (; cursor < source.length; cursor++) {
          if (source[cursor] === "{") braces++;
          else if (source[cursor] === "}" && --braces === 0) break;
        }
        text += source.slice(from, cursor + 1);
        cursor++;
        continue;
      }
      text += source[cursor];
      cursor++;
    }
    return { end: cursor + 1, text };
  };
  /** past a balanced (…) or […] starting at `at` */
  const balanced = (at: number): number => {
    const opener = source[at]!;
    const closer = opener === "(" ? ")" : "]";
    let nesting = 0;
    for (let cursor = at; cursor < source.length; cursor++) {
      const char = source[cursor]!;
      if (char === "'" || char === '"' || char === "`") {
        cursor = stringAt(cursor).end - 1;
        continue;
      }
      if (char === opener) nesting++;
      else if (char === closer && --nesting === 0) return cursor + 1;
    }
    return source.length;
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      index = stringAt(index).end;
      last = char;
      continue;
    }
    if (char === "/" && (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last))) {
      // a regex: to its closing slash, past any class
      let cursor = index + 1;
      let inClass = false;
      for (; cursor < source.length && source[cursor] !== "\n"; cursor++) {
        if (source[cursor] === "\\") cursor++;
        else if (source[cursor] === "[") inClass = true;
        else if (source[cursor] === "]") inClass = false;
        else if (source[cursor] === "/" && !inClass) break;
      }
      index = cursor + 1;
      last = "/";
      continue;
    }
    if (/[A-Za-z_$]/.test(char) && !isWord(source[index - 1]) && source[index - 1] !== ".") {
      let nameEnd = index;
      while (isWord(source[nameEnd])) nameEnd++;
      const name = source.slice(index, nameEnd);
      if (GROUPS.has(name) || TESTS.has(name)) {
        // its modifiers, then its call and a title
        let cursor = nameEnd;
        for (;;) {
          cursor = blank(cursor);
          if (source[cursor] === ".") {
            let modifierEnd = blank(cursor + 1);
            const from = modifierEnd;
            while (isWord(source[modifierEnd])) modifierEnd++;
            const modifier = source.slice(from, modifierEnd);
            if (!MODIFIERS.has(modifier)) break;
            cursor = blank(modifierEnd);
            // `.each([...])(` or `.each\`table\`(`: its table is not the title
            if (source[cursor] === "(" && modifier !== "only" && modifier !== "skip") {
              const after = blank(balanced(cursor));
              if (source[after] === "(") cursor = after;
            } else if (source[cursor] === "`") cursor = stringAt(cursor).end;
            continue;
          }
          break;
        }
        cursor = blank(cursor);
        const quoteAt = blank(cursor + 1);
        if (source[cursor] === "(" && (source[quoteAt] === "'" || source[quoteAt] === '"' || source[quoteAt] === "`")) {
          const title = stringAt(quoteAt);
          depth++;
          open.push({ group: GROUPS.has(name), title: title.text, start: lineAt[index]!, depth });
          index = title.end;
          last = source[quoteAt]!;
          continue;
        }
      }
      index = nameEnd;
      last = "a";
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      const top = open[open.length - 1];
      if (top && depth < top.depth) {
        open.pop();
        if (top.group) groups.push({ start: top.start, end: lineAt[index]! });
        else out.push({ under: open.filter((frame) => frame.group).map((frame) => frame.title), title: top.title, start: top.start, end: lineAt[index]! });
      }
    }
    if (!/\s/.test(char)) last = char;
    index++;
  }
  return { tests: out.sort((a, b) => a.start - b.start), groups };
}

/** Named test functions: `function testFoo(`, `func TestFoo(`, `def test_foo(` —
 *  a brace language to its matching brace, Python to where its indent ends. */
function namedTests(lines: ReadonlyArray<string>): ReadonlyArray<Found> {
  const out: Array<Found> = [];
  const head = /^(\s*)(?:(?:public|protected|private|static|async|final)\s+)*(function|func|def)\s+((?:test|Test)\w*)\s*\(/;
  lines.forEach((line, index) => {
    const match = head.exec(line);
    if (!match) return;
    let end = index;
    if (match[2] === "def") {
      const indent = match[1]!.length;
      for (let row = index + 1; row < lines.length; row++) {
        const text = lines[row]!;
        if (text.trim() === "") continue;
        if (text.length - text.trimStart().length <= indent) break;
        end = row;
      }
    } else {
      let braces = 0;
      let opened = false;
      outer: for (let row = index; row < lines.length; row++)
        for (const char of lines[row]!) {
          if (char === "{") {
            braces++;
            opened = true;
          } else if (char === "}" && --braces === 0 && opened) {
            end = row;
            break outer;
          }
        }
    }
    out.push({ under: [], title: match[3]!, start: index + 1, end: end + 1 });
  });
  return out;
}

const keyOf = (test: Found) => [...test.under, test.title].join("\u0000");

/** A hunk's first line on the old side. */
const oldStartOf = (hunk: Hunk): number => Number(/^@@ -(\d+)/.exec(hunk.header)?.[1] ?? hunk.lines.find((line) => line.old !== undefined)?.old ?? 0);
const countOf = (hunk: Hunk, side: "old" | "new") => hunk.lines.filter((line) => line[side] !== undefined).length;

/** Lines `start`…`end` of one side of a file as a diff: the hunks' own lines
 *  where they fall (the other side's lines among them in place), the file's
 *  text, unchanged, between them — each line numbered on both sides. */
export function span(file: string, hunks: ReadonlyArray<Hunk>, side: "old" | "new", start: number, end: number, text: ReadonlyArray<string>): Hunk {
  const other = side === "new" ? "old" : "new";
  const startOf = (hunk: Hunk) => (side === "new" ? hunk.newStart : oldStartOf(hunk));
  const lines: Array<DiffLine> = [];
  for (let lineNumber = start; lineNumber <= end; lineNumber++) {
    const hunk = hunks.find((candidate) => lineNumber >= startOf(candidate) && lineNumber < startOf(candidate) + countOf(candidate, side));
    if (hunk) {
      const at = hunk.lines.findIndex((line) => line[side] === lineNumber);
      // the other side's lines just above it (not above the first line shown)
      let from = at;
      while (lineNumber > start && from > 0 && hunk.lines[from - 1]![side] === undefined) from--;
      lines.push(...hunk.lines.slice(from, at + 1));
      // and just below the hunk's last line on this side, when the test goes on past it
      if (lineNumber < end && lineNumber === startOf(hunk) + countOf(hunk, side) - 1) {
        let to = at + 1;
        while (to < hunk.lines.length && hunk.lines[to]![side] === undefined) to++;
        lines.push(...hunk.lines.slice(at + 1, to));
      }
      continue;
    }
    // unchanged: the other side's number, shifted by every hunk above it
    const shift = hunks.filter((above) => startOf(above) + countOf(above, side) <= lineNumber).reduce((sum, above) => sum + countOf(above, other) - countOf(above, side), 0);
    lines.push({ kind: " ", text: text[lineNumber - 1] ?? "", [side]: lineNumber, [other]: lineNumber + shift } as DiffLine);
  }
  const shownNew = lines.filter((line) => line.new !== undefined);
  return { id: `test:${file}:${side}:${start}`, file, header: "", newStart: shownNew[0]?.new ?? 0, newLines: shownNew.length, lines };
}

/** One test file's tests that this diff adds, changes or removes — each with
 *  its code whole as a hunk — and its hunks that touch no test (imports,
 *  helpers, setup). `after` is the file at the branch, `before` at the base
 *  it forked from; either is null where it cannot be read (or is not there):
 *  then the tests are read from the hunks' own lines, as far as they go. */
export function testsOfFile(file: string, hunks: ReadonlyArray<Hunk>, after: ReadonlyArray<string> | null, before: ReadonlyArray<string> | null): TestFile {
  const mine = hunks.filter((hunk) => hunk.file === file);
  // with no text, the hunks' new side is all of the file there is
  const fromHunks = (side: "old" | "new") => {
    const text: Array<string> = [];
    for (const hunk of mine) for (const line of hunk.lines) if (line[side] !== undefined) text[line[side]! - 1] = line.text;
    return Array.from(text, (known) => known ?? "");
  };
  const deleted = mine.length > 0 && mine.every((hunk) => hunk.lines.every((line) => line.new === undefined));
  const newText = after ?? (deleted ? [] : fromHunks("new"));
  const oldText = before ?? (after === null ? fromHunks("old") : []);
  const now = scan(newText);
  const was = scan(oldText);
  const nowTests = now.tests;
  const wasTests = was.tests;
  // where each changed line falls on each side: an added line at its new
  // number, a removed one between the new lines around it
  const added = new Set<number>();
  const removedAt = new Set<number>();
  const removed = new Set<number>();
  for (const hunk of mine) {
    let nextNew = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.new !== undefined) nextNew = line.new + 1;
      if (line.kind === "+") added.add(line.new!);
      if (line.kind === "-") {
        removed.add(line.old!);
        removedAt.add(nextNew);
      }
    }
  }
  const within = (test: Found, lines: ReadonlySet<number>, from: number) => [...lines].some((lineNumber) => lineNumber >= from && lineNumber <= test.end);
  // a removal just above a test's first line is the code above it, not the test
  const changedNow = (test: Found) => within(test, added, test.start) || within(test, removedAt, test.start + 1);
  const wasKeys = new Set(wasTests.map(keyOf));
  const nowKeys = new Set(nowTests.map(keyOf));
  // a test's id is its file and titles — what a reader's mark on it follows
  // across pushes — and a count where one file repeats them
  const ids = new Map<string, number>();
  const idOf = (key: string) => {
    const count = ids.get(key) ?? 0;
    ids.set(key, count + 1);
    return count === 0 ? key : `${key}\u0000${count}`;
  };
  const tests: Array<TestCase> = [];
  for (const test of nowTests) {
    if (!changedNow(test)) continue;
    const code = span(file, mine, "new", test.start, test.end, newText);
    const isNew = before === null && after === null ? code.lines.every((line) => line.kind !== " ") : !wasKeys.has(keyOf(test));
    tests.push({ id: idOf(`${file}\u0000${keyOf(test)}`), file, under: test.under, title: test.title, change: isNew ? "added" : "changed", code });
  }
  for (const test of wasTests) {
    if (nowKeys.has(keyOf(test)) || !within(test, removed, test.start)) continue;
    // what replaced it is read where it is now, not here
    const code = span(file, mine, "old", test.start, test.end, oldText);
    tests.push({ id: idOf(`${file}\u0000${keyOf(test)}\u0000removed`), file, under: test.under, title: test.title, change: "removed", code: { ...code, lines: code.lines.filter((line) => line.kind !== "+") } });
  }
  // a hunk with a changed line in no listed test is shown as it is: setup, a
  // helper. Only beside a listed test do imports, blank lines and the first
  // and last lines of a describe added or removed whole go unshown — they
  // frame it; a renamed describe, or an import alone, is still a change.
  const shown = tests.flatMap((test) => test.code.lines.filter((line) => line.kind !== " "));
  const inTest = (line: DiffLine) => shown.some((shownLine) => shownLine.kind === line.kind && shownLine.old === line.old && shownLine.new === line.new);
  const whole = (groups: ReadonlyArray<Group>, changed: ReadonlySet<number>, lineNumber: number) =>
    groups.some((group) => (lineNumber === group.start || lineNumber === group.end) && Array.from({ length: group.end - group.start + 1 }, (_, offset) => group.start + offset).every((groupLine) => changed.has(groupLine)));
  const framing = (line: DiffLine) =>
    tests.length > 0 &&
    ((line.kind === "+" ? whole(now.groups, added, line.new!) : whole(was.groups, removed, line.old!)) || /^\s*(?:import\b|export\s+\*|use\s|require\(|from\s+\S+\s+import\b|$)/.test(line.text));
  const other = mine.filter((hunk) => hunk.lines.some((line) => line.kind !== " " && !inTest(line) && !framing(line))).map((hunk) => hunk.id);
  return { file, tests, other, decisions: [], forks: [] };
}
