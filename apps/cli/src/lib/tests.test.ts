import { describe, expect, it } from "vitest";
import { parseDiff } from "./reviewView";
import { isTest, testsIn, testsOfFile } from "./tests";

const titles = (lines: ReadonlyArray<string>) => testsIn(lines).map((test) => `${[...test.under, test.title].join(" › ")} ${test.start}-${test.end}`);

describe("the tests in a file", () => {
  it("each test by its describes and title, with the lines it spans — past strings, regexes and comments", () => {
    const src = [
      'import { describe, it, expect } from "vitest";',
      'describe("outbox", () => {',
      '  it("keeps a send that failed", () => {',
      '    expect(f("(")).toMatch(/\\)/); // )',
      "  });",
      '  describe.skip("when offline", () => {',
      "    it.each([1, 2])('retries %i', (n) => {});",
      "  });",
      "  /* it(\"not a test\", () => {}) */",
      "  test.skip(`waits ${x} seconds`, () => {",
      "  });",
      "});",
      'it("top", () => {})',
    ];
    expect(titles(src)).toEqual([
      "outbox › keeps a send that failed 3-5",
      "outbox › when offline › retries %i 7-7",
      "outbox › waits ${x} seconds 10-11",
      "top 13-13",
    ]);
  });

  it("named test functions where there are no test calls", () => {
    expect(titles(["class OutboxTest {", "  public function testKeepsAFailedSend(): void {", "    $this->assertTrue(true);", "  }", "}"])).toEqual(["testKeepsAFailedSend 2-4"]);
    expect(titles(["def test_retries():", "    assert True", "", "def helper():", "    pass"])).toEqual(["test_retries 1-2"]);
  });

  it("a test file by name or folder", () => {
    expect(["a/Outbox.test.ts", "a/x.spec.tsx", "tests/Feature/Foo.php", "src/__tests__/x.js", "src/testing.ts", "src/latest/x.ts"].map(isTest)).toEqual([true, true, true, true, false, false]);
  });
});

describe("a test file's changed tests", () => {
  const before = ['describe("a", () => {', '  it("one", () => {', "    expect(1).toBe(1);", "  });", '  it("two", () => {', "    expect(2).toBe(2);", "  });", "});"];
  const after = ['describe("a", () => {', '  it("one", () => {', "    expect(1).toBe(3);", "  });", '  it("three", () => {', "    expect(3).toBe(3);", "  });", "});"];
  const diff = [
    "diff --git a/a.test.ts b/a.test.ts",
    "--- a/a.test.ts",
    "+++ b/a.test.ts",
    "@@ -1,8 +1,8 @@",
    ' describe("a", () => {',
    '   it("one", () => {',
    "-    expect(1).toBe(1);",
    "+    expect(1).toBe(3);",
    "   });",
    '-  it("two", () => {',
    "-    expect(2).toBe(2);",
    '+  it("three", () => {',
    "+    expect(3).toBe(3);",
    "   });",
    " });",
    "",
  ].join("\n");
  const hunks = parseDiff(diff);

  it("added, changed and removed, each with its whole code — what changed in it marked", () => {
    const file = testsOfFile("a.test.ts", hunks, after, before);
    expect(file.tests.map((test) => `${test.change} ${test.under.join(" › ")} › ${test.title}`)).toEqual(["changed a › one", "added a › three", "removed a › two"]);
    expect(file.tests[0]!.code.lines.map((line) => `${line.kind}${line.old ?? ""}:${line.new ?? ""} ${line.text.trim()}`)).toEqual([" 2:2 it(\"one\", () => {", "-3: expect(1).toBe(1);", "+:3 expect(1).toBe(3);", " 4:4 });"]);
    // a removed test shows its own lines, not what took its place
    expect(file.tests[2]!.code.lines.map((line) => line.kind)).toEqual(["-", "-", " "]);
    expect(file.other).toEqual([]);
    // a mark follows the test's titles, not its lines
    expect(file.tests[0]!.id).toBe("a.test.ts\u0000a\u0000one");
  });

  it("an untouched test is not listed; a change outside every test is shown as it is — never lost", () => {
    const later = ['import { x } from "./x";', "const helper = () => 1;", ...after];
    const diffHunks = parseDiff(["diff --git a/a.test.ts b/a.test.ts", "--- a/a.test.ts", "+++ b/a.test.ts", "@@ -0,0 +1,2 @@", '+import { x } from "./x";', "+const helper = () => 1;", ""].join("\n"));
    const file = testsOfFile("a.test.ts", diffHunks, later, after);
    expect(file.tests).toEqual([]);
    expect(file.other).toEqual(diffHunks.map((hunk) => hunk.id));
    // an import alone, a renamed describe: no test lists them, so they are shown
    const imported = parseDiff(["diff --git a/a.test.ts b/a.test.ts", "--- a/a.test.ts", "+++ b/a.test.ts", "@@ -0,0 +1 @@", '+import { x } from "./x";', ""].join("\n"));
    expect(testsOfFile("a.test.ts", imported, ['import { x } from "./x";', ...after], after).other).toEqual(imported.map((hunk) => hunk.id));
    const renamed = parseDiff(["diff --git a/a.test.ts b/a.test.ts", "--- a/a.test.ts", "+++ b/a.test.ts", "@@ -1,2 +1,2 @@", '-describe("a", () => {', '+describe("b", () => {', '   it("one", () => {', ""].join("\n"));
    expect(testsOfFile("a.test.ts", renamed, ['describe("b", () => {', ...after.slice(1)], after).other).toEqual(renamed.map((hunk) => hunk.id));
  });

  it("beside a new test, its import is its frame, not a change outside it", () => {
    const later = ['import { x } from "./x";', ...after.slice(0, 7), '  it("four", () => {});', "});"];
    const diffHunks = parseDiff(["diff --git a/a.test.ts b/a.test.ts", "--- a/a.test.ts", "+++ b/a.test.ts", "@@ -0,0 +1 @@", '+import { x } from "./x";', "@@ -7,2 +8,3 @@", "   });", '+  it("four", () => {});', " });", ""].join("\n"));
    const file = testsOfFile("a.test.ts", diffHunks, later, after);
    expect(file.tests.map((test) => `${test.change} ${test.title}`)).toEqual(["added four"]);
    expect(file.other).toEqual([]);
  });

  it("a new file's describe and imports are its tests' frame, not changes outside them", () => {
    const diffHunks = parseDiff(["diff --git a/n.test.ts b/n.test.ts", "--- /dev/null", "+++ b/n.test.ts", "@@ -0,0 +1,7 @@", ...['import { it } from "vitest";', "", ...after.slice(0, 4), "});"].map((line) => `+${line}`), ""].join("\n"));
    const file = testsOfFile("n.test.ts", diffHunks, ['import { it } from "vitest";', "", ...after.slice(0, 4), "});"], null);
    expect(file.tests.map((test) => test.title)).toEqual(["one"]);
    expect(file.other).toEqual([]);
  });

  it("with no text to read, a new test is still read from its hunk", () => {
    const diffHunks = parseDiff(["diff --git a/n.test.ts b/n.test.ts", "--- /dev/null", "+++ b/n.test.ts", "@@ -0,0 +1,3 @@", '+it("works", () => {', "+  expect(1).toBe(1);", "+});", ""].join("\n"));
    const file = testsOfFile("n.test.ts", diffHunks, null, null);
    expect(file.tests.map((test) => `${test.change} ${test.title} ${test.code.lines.length}`)).toEqual(["added works 3"]);
  });
});
