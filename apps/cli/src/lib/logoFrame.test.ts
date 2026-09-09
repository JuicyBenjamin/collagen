import { describe, expect, it } from "vitest";
import { LOGO, logoFrame, mix } from "./logoFrame";

const p = { accent: "#7aa2f7", fg: "#c0caf5", dim: "#565f89" };
const letters = [3, 3, 3, 3, 3, 3, 3, 4]; // c o l l a g e n, tiny font

describe("the opening", () => {
  it("mix blends hex colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#000000", "#ffffff", 2)).toBe("#ffffff");
  });

  it("letters arrive one at a time, white-hot", () => {
    const f0 = logoFrame(0, null, letters, "peer-to-peer", p);
    expect(f0.columns.slice(0, 3).every((c) => c === p.fg)).toBe(true); // the first letter, flashing
    expect(f0.columns.slice(4).every((c) => c === null)).toBe(true); // the rest not yet
    const f2 = logoFrame(LOGO.letterEvery * 2, null, letters, "peer-to-peer", p);
    expect(f2.columns.filter((c) => c !== null).length).toBe(3 * 3 + 2); // three letters + two spaces
    expect(f2.tagline).toBe("");
  });

  it("the tagline types itself and the cursor blinks while booting", () => {
    const f = logoFrame(LOGO.taglineFrom + LOGO.taglineEvery * 4, null, letters, "peer-to-peer", p);
    expect(f.tagline).toBe("peer");
    expect(["▌", " "]).toContain(f.cursor);
    expect(f.done).toBe(false);
  });

  it("the sheen moves: two frames a bit apart light different columns", () => {
    const t0 = 3000;
    const a = logoFrame(t0, null, letters, "peer-to-peer", p).columns;
    const b = logoFrame(t0 + 200, null, letters, "peer-to-peer", p).columns;
    expect(a).not.toEqual(b);
    expect(a.every((c) => c !== null)).toBe(true);
  });

  it("ready: everything shows, then settles into the accent and stops", () => {
    const readyAt = 400; // came up mid-reveal
    const early = logoFrame(readyAt + 10, readyAt, letters, "peer-to-peer", p);
    expect(early.columns.every((c) => c !== null)).toBe(true);
    expect(early.tagline).toBe("peer-to-peer");
    const end = logoFrame(readyAt + LOGO.settle + 50, readyAt, letters, "peer-to-peer", p);
    expect(end.columns.filter((_, i) => ![3, 7, 11, 15, 19, 23, 27].includes(i)).every((c) => c === p.accent)).toBe(true);
    expect(end.cursor).toBe("");
    expect(end.taglineColor).toBe(p.dim);
    expect(end.done).toBe(true);
  });
});
