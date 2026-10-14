import { describe, expect, it } from "vitest";
import { LOGO, logoFrame, mix } from "./logoFrame";

const palette = { accent: "#7aa2f7", foreground: "#c0caf5", dim: "#565f89" };
const letters = [3, 3, 3, 3, 3, 3, 3, 4]; // c o l l a g e n, tiny font

describe("the opening", () => {
  it("mix blends hex colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#000000", "#ffffff", 2)).toBe("#ffffff");
  });

  it("letters arrive one at a time, white-hot", () => {
    const firstFrame = logoFrame(0, null, letters, "peer-to-peer", palette);
    expect(firstFrame.columns.slice(0, 3).every((column) => column === palette.foreground)).toBe(true); // the first letter, flashing
    expect(firstFrame.columns.slice(4).every((column) => column === null)).toBe(true); // the rest not yet
    const thirdFrame = logoFrame(LOGO.letterEvery * 2, null, letters, "peer-to-peer", palette);
    expect(thirdFrame.columns.filter((column) => column !== null).length).toBe(3 * 3 + 2); // three letters + two spaces
    expect(thirdFrame.tagline).toBe("");
  });

  it("the tagline types itself and the cursor blinks while booting", () => {
    const frame = logoFrame(LOGO.taglineFrom + LOGO.taglineEvery * 4, null, letters, "peer-to-peer", palette);
    expect(frame.tagline).toBe("peer");
    expect(["▌", " "]).toContain(frame.cursor);
    expect(frame.done).toBe(false);
  });

  it("the sheen moves: two frames a bit apart light different columns", () => {
    const start = 3000;
    const before = logoFrame(start, null, letters, "peer-to-peer", palette).columns;
    const after = logoFrame(start + 200, null, letters, "peer-to-peer", palette).columns;
    expect(before).not.toEqual(after);
    expect(before.every((column) => column !== null)).toBe(true);
  });

  it("ready: everything shows, then settles into the accent and stops", () => {
    const readyAt = 400; // came up mid-reveal
    const early = logoFrame(readyAt + 10, readyAt, letters, "peer-to-peer", palette);
    expect(early.columns.every((column) => column !== null)).toBe(true);
    expect(early.tagline).toBe("peer-to-peer");
    const end = logoFrame(readyAt + LOGO.settle + 50, readyAt, letters, "peer-to-peer", palette);
    expect(end.columns.filter((_, index) => ![3, 7, 11, 15, 19, 23, 27].includes(index)).every((column) => column === palette.accent)).toBe(true);
    expect(end.cursor).toBe("");
    expect(end.taglineColor).toBe(palette.dim);
    expect(end.done).toBe(true);
  });
});
