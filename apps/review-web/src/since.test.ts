import { describe, expect, it } from "vitest";
import type { Hunk } from "./data";
import { moved, placeSince } from "./since";

const h = (id: string, newStart: number, newLines: number, kinds = "+"): Hunk => ({
  id,
  file: "a.ts",
  header: "@@",
  newStart,
  newLines,
  lines: [...kinds].map((k, i) => ({ kind: k as "+" | "-" | " ", text: `l${i}`, new: newStart + i })),
});

describe("what moved since a file was viewed", () => {
  it("goes under the hunk it falls in, and a hunk where nothing moved gets none", () => {
    const base = [h("a#0", 10, 20), h("a#1", 200, 10)];
    const placed = placeSince(base, [h("s#0", 205, 2)]);
    expect(placed.get("a#1")!.map((x) => x.id)).toEqual(["s#0"]);
    expect(placed.get("a#0")).toEqual([]);
  });

  it("a change outside every hunk goes under the file's first, never lost", () => {
    const placed = placeSince([h("a#0", 10, 5), h("a#1", 50, 5)], [h("s#0", 400, 1)]);
    expect(placed.get("a#0")!.map((x) => x.id)).toEqual(["s#0"]);
  });

  it("a removal of lines counts from where it was", () => {
    const placed = placeSince([h("a#0", 10, 5)], [h("s#0", 12, 0, "-")]);
    expect(placed.get("a#0")!.map((x) => x.id)).toEqual(["s#0"]);
  });

  it("counts what was added and removed", () => {
    expect(moved([h("s#0", 1, 2, "+- "), h("s#1", 9, 1, "+")])).toEqual({ added: 2, removed: 1 });
  });
});
