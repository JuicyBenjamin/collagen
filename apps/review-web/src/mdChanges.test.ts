import { describe, expect, it } from "vitest";
import type { DiffLine, Hunk } from "./data";
import type { Block, Inline } from "./markdown";
import { changedBlocks, oldSource } from "./mdChanges";

const hunk = (newStart: number, newLines: number, lines: ReadonlyArray<DiffLine>): Hunk => ({ id: `doc.md#${newStart}`, file: "doc.md", header: "", newStart, newLines, lines });
/** What a block reads as, words taken out as [-…-], put in as {+…+}, bold as *…*. */
const text = (nodes: ReadonlyArray<Inline>): string =>
  nodes
    .map((node) => (node.kind === "text" ? node.text : node.kind === "went" ? `[-${text(node.children)}-]` : node.kind === "came" ? `{+${text(node.children)}+}` : node.kind === "strong" ? `*${text(node.children)}*` : ""))
    .join("");
const blockText = (block: Block): string =>
  block.kind === "p" || block.kind === "heading" ? text(block.children) : block.kind === "list" ? block.items.flatMap((item) => item.blocks.map(blockText)).join(" ") : "";
const read = (blocks: ReturnType<typeof changedBlocks>) => blocks.map((block) => `${block.kind}${block.gapBefore ? " after a gap" : ""}: ${block.blocks.map(blockText).join(" ")}`);

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

  it("shows an edited paragraph once, the words it took out and put in marked, and skips what stayed", () => {
    expect(read(changedBlocks(NOW, DIFF))).toEqual(["edited after a gap: [-Old-]{+New+} intro.", "removed after a gap: Gone."]);
  });

  it("weighs a list item by item: one reworded item reads alone, as an edit, its formatting kept", () => {
    const now = "- one\n- reads **every** ticket's step\n- three\n";
    const diff = [
      hunk(1, 3, [
        { kind: " ", text: "- one", old: 1, new: 1 },
        { kind: "-", text: "- reads **one** ticket's step", old: 2 },
        { kind: "+", text: "- reads **every** ticket's step", new: 2 },
        { kind: " ", text: "- three", old: 3, new: 3 },
      ]),
    ];
    expect(read(changedBlocks(now, diff))).toEqual(["edited after a gap: reads [-*one*-]{+*every*+} ticket's step"]);
  });

  it("keeps an item rewritten past recognising as one out and one in, and items added side by side as one list", () => {
    const now = "1. one\n2. something else entirely\n3. new\n";
    const diff = [
      hunk(1, 3, [
        { kind: " ", text: "1. one", old: 1, new: 1 },
        { kind: "-", text: "2. two", old: 2 },
        { kind: "+", text: "2. something else entirely", new: 2 },
        { kind: "+", text: "3. new", new: 3 },
      ]),
    ];
    expect(read(changedBlocks(now, diff))).toEqual(["removed after a gap: two", "added: something else entirely new"]);
  });
});
