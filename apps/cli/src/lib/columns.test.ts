import { describe, expect, it } from "vitest";
import { cells, clip, fitColumns, MIN_INFO } from "./columns";

describe("a list's columns", () => {
  it("are as wanted with room to spare, or before the pane is measured", () => {
    expect(fitColumns({ lead: 30, info: 10 }, 100)).toEqual({ lead: 30, info: 10 });
    expect(fitColumns({ lead: 30, info: 10 }, undefined)).toEqual({ lead: 30, info: 10 });
  });

  it("keep the titles first: a long annotation gets what is left, not the titles' room", () => {
    // a 60-cell title and a waiting row naming a 60-cell predecessor, in a narrow pane
    const { lead, info } = fitColumns({ lead: 60, info: 70 }, 50);
    expect(lead).toBe(50 - MIN_INFO);
    expect(info).toBe(MIN_INFO);
    expect(lead + info).toBeLessThanOrEqual(50);
  });

  it("never run past the pane, however narrow", () => {
    for (const room of [0, 5, 12, 13, 30]) {
      const { lead, info } = fitColumns({ lead: 60, info: 70 }, room);
      expect(lead + info).toBeLessThanOrEqual(room);
      expect(lead).toBeGreaterThanOrEqual(0);
    }
    expect(fitColumns({ lead: 60, info: 4 }, 30)).toEqual({ lead: 26, info: 4 });
  });

  it("count terminal cells: wide characters two, combining marks none", () => {
    expect(cells("界".repeat(20))).toBe(40);
    expect(cells("é")).toBe(1);
    expect(cells("± you")).toBe(5);
  });

  it("clip at the end, within the cells given", () => {
    expect(clip("A sixty character predecessor title", 12)).toBe("A sixty cha…");
    expect(cells(clip("界界界界界", 5))).toBeLessThanOrEqual(5);
    expect(clip("short", 12)).toBe("short");
    expect(clip("anything", 0)).toBe("");
  });
});
