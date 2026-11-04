import { describe, expect, it } from "vitest";
import type { Hunk } from "@collagen/review-web/data";
import { missingWhys } from "./missingWhys";

const hunk = (file: string, number: number, newStart: number, newLines: number): Hunk => ({
  id: `${file}#${number}`,
  file,
  header: "@@",
  newStart,
  newLines,
  lines: Array.from({ length: newLines }, (_, index) => ({ kind: "+" as const, text: `l${index}`, new: newStart + index })),
});

describe("the whys a review is missing", () => {
  it("are the decisions that give no reason, then the changes no decision covers, by their lines", () => {
    const decisions = [
      { id: "d1", title: "Rows map to text", what: "rows become text", userWhy: "the reader asked for it", where: ["src/rows.ts"] },
      { id: "d2", title: "Paging is pinned", what: "pages stay put", agentWhy: "a scroll jumped", where: ["src/page.ts"] },
      { id: "d3", title: "Sizes are fixed", what: "sizes are hard-coded", where: ["src/size.ts"] },
    ];
    const hunks = [hunk("src/rows.ts", 0, 1, 3), hunk("src/size.ts", 1, 4, 2), hunk("src/routes.ts", 2, 10, 5), hunk("notes.txt", 3, 7, 1)];
    expect(missingWhys({ decisions, forks: [] }, hunks)).toEqual([{ decision: "d3", title: "Sizes are fixed" }, { where: "src/routes.ts:10-14" }, { where: "notes.txt:7" }]);
  });

  it("are none when every decision has a reason and covers its change", () => {
    const decisions = [{ id: "d1", title: "Rows map to text", what: "rows become text", agentWhy: "a reader asked", where: ["src/rows.ts"] }];
    expect(missingWhys({ decisions, forks: [] }, [hunk("src/rows.ts", 0, 1, 3)])).toEqual([]);
  });
});
