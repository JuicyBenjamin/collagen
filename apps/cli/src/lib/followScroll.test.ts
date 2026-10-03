import { describe, expect, it } from "vitest";
import { followTop } from "./followScroll";

const view = (top: number, height = 5, total = 20) => ({ top, height, total });
const row = (at: number, size = 1) => ({ kind: "edge" as const, at, size });

describe("a list following its cursor", () => {
  it("does not move while the row is in view", () => {
    for (const at of [3, 4, 5, 6, 7]) expect(followTop(view(3), row(at))).toBe(3);
  });

  it("scrolls down only when the row would fall below the bottom, by exactly enough", () => {
    expect(followTop(view(3), row(8))).toBe(4);
    // a row below a gap (a blank line, a heading) lands on the bottom edge
    expect(followTop(view(3), row(10))).toBe(6);
    // a taller row (an unfolded message) brings its whole height in
    expect(followTop(view(3), row(7, 3))).toBe(5);
  });

  it("scrolls up only when the row would rise above the top, by exactly enough", () => {
    expect(followTop(view(3), row(2))).toBe(2);
    expect(followTop(view(6), row(1))).toBe(1);
  });

  it("walking down then up: still in the middle, one line at a time at each edge", () => {
    let top = 0;
    const tops: Array<number> = [];
    for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0]) {
      top = followTop(view(top), row(at));
      tops.push(top);
    }
    expect(tops).toEqual([0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 2, 1, 0]);
  });

  it("a row taller than the view: in at its top, then still while read — never flipping on repeated passes", () => {
    // a 10-line message in a 5-line view, below it
    const tall = { kind: "edge" as const, at: 8, size: 10 };
    let top = followTop(view(0), tall);
    expect(top).toBe(8);
    const tops = [1, 2, 3].map(() => (top = followTop(view(top), tall)));
    expect(tops).toEqual([8, 8, 8]);
    // read down inside it: left where the reader put it
    expect(followTop(view(11), tall)).toBe(11);
    expect(followTop(view(13), tall)).toBe(13);
    // scrolled away from it: back to its top
    expect(followTop(view(2), tall)).toBe(8);
  });

  it("pinned to the start, the end, or a row put at the top — never past either end", () => {
    expect(followTop(view(7), { kind: "start" })).toBe(0);
    expect(followTop(view(0), { kind: "end" })).toBe(15);
    expect(followTop(view(0), { kind: "top", at: 9 })).toBe(9);
    expect(followTop(view(0), { kind: "top", at: 19 })).toBe(15);
    // a list shorter than its view never scrolls
    expect(followTop(view(0, 10, 4), { kind: "end" })).toBe(0);
    expect(followTop(view(0, 10, 4), row(3))).toBe(0);
  });
});
