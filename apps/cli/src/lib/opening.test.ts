import { describe, expect, it } from "vitest";
import { LOGO } from "./logoFrame";
import { OPENING, opening } from "./opening";

const dims = { cols: 100, rows: 30, w: 32, h: 3 };

describe("the opening's timeline", () => {
  it("boots centred, and stays there until the app is up", () => {
    const f = opening(500, null, dims);
    expect(f).toEqual({ phase: "boot", readyAt: null, x: 33, y: 12 });
    expect(opening(9000, null, dims).phase).toBe("boot");
  });

  it("a fast boot is still held for the reveal and one sweep", () => {
    expect(opening(1000, 300, dims).phase).toBe("boot");
    expect(opening(OPENING.hold + 10, 300, dims)).toMatchObject({ phase: "settle", readyAt: OPENING.hold });
  });

  it("settles in place, glides to the header, then is done", () => {
    const upAt = 3000;
    const moveStart = upAt + LOGO.settle;
    expect(opening(moveStart - 1, upAt, dims)).toMatchObject({ phase: "settle", x: 33, y: 12 });
    const mid = opening(moveStart + OPENING.move / 2, upAt, dims);
    expect(mid.phase).toBe("move");
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(33);
    expect(opening(moveStart + OPENING.move, upAt, dims)).toEqual({ phase: "done", readyAt: upAt, x: 0, y: 0 });
  });
});
