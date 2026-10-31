import { describe, expect, it } from "vitest";
import type { DiffLine, Hunk } from "./data";
import { changedBlocks, oldSource } from "./mdChanges";

const hunk = (newStart: number, newLines: number, lines: ReadonlyArray<DiffLine>): Hunk => ({ id: `doc.md#${newStart}`, file: "doc.md", header: "", newStart, newLines, lines });
const words = (blocks: ReturnType<typeof changedBlocks>) => blocks.map((block) => `${block.kind}${block.gapBefore ? " after a gap" : ""}: ${JSON.stringify(block.blocks).match(/"text":"([^"]+)"/)?.[1]}`);

// before: "# Title", "", "Old intro.", "", "Kept.", "", "Gone."
const NOW = "# Title\n\nNew intro.\n\nKept.\n";
const DIFF = [
  hunk(1, 4, [
    { kind: " ", text: "# Title", old: 1, new: 1 },
    { kind: " ", text: "", old: 2, new: 2 },
    { kind: "-", text: "Old intro.", old: 3 },
    { kind: "+", text: "New intro.", new: 3 },
    { kind: " ", text: "", old: 4, new: 4 },
  ]),
  hunk(5, 2, [
    { kind: " ", text: "Kept.", old: 5, new: 5 },
    { kind: " ", text: "", old: 6, new: 6 },
    { kind: "-", text: "Gone.", old: 7 },
  ]),
];

describe("a changed Markdown file read as what changed", () => {
  it("puts the file before the change back together", () => {
    expect(oldSource(NOW, DIFF)).toBe("# Title\n\nOld intro.\n\nKept.\n\nGone.");
  });

  it("shows a rewritten paragraph as the old one out, the new one in, and skips what stayed", () => {
    expect(words(changedBlocks(NOW, DIFF))).toEqual(["removed after a gap: Old intro.", "added: New intro.", "removed after a gap: Gone."]);
  });

  it("an old list goes before the new one when an item inside it was rewritten", () => {
    const now = "- one\n- TWO\n- three\n";
    const diff = [
      hunk(1, 3, [
        { kind: " ", text: "- one", old: 1, new: 1 },
        { kind: "-", text: "- two", old: 2 },
        { kind: "+", text: "- TWO", new: 2 },
        { kind: " ", text: "- three", old: 3, new: 3 },
      ]),
    ];
    expect(changedBlocks(now, diff).map((block) => block.kind)).toEqual(["removed", "added"]);
  });
});
