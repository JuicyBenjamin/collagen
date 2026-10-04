import { describe, expect, it } from "vitest";
import type { Hunk } from "./data";
import { questionFor, spotFor } from "./assumed";

const hunk: Hunk = {
  id: "src/export.ts#1",
  file: "src/export.ts",
  header: "@@",
  newStart: 1,
  newLines: 3,
  lines: [
    { kind: " ", text: "a", old: 1, new: 1 },
    { kind: "-", text: "b", old: 2 },
    { kind: "+", text: "c", new: 2 },
    { kind: " ", text: "d", old: 3, new: 3 },
  ],
};
const hunksOf = (f: string) => (f === "src/export.ts" ? [hunk] : []);

describe("an assumption put to the author", () => {
  it("goes on the line its where names, when the diff shows it", () => {
    expect(spotFor(["src/export.ts:3"], hunksOf)).toEqual({ file: "src/export.ts", line: 3 });
  });
  it("else on the first line its file's change adds", () => {
    expect(spotFor(["src/export.ts:40"], hunksOf)).toEqual({ file: "src/export.ts", line: 2 });
    expect(spotFor(["src/export.ts"], hunksOf)).toEqual({ file: "src/export.ts", line: 2 });
  });
  it("past files the diff does not change, to one it does — or nowhere", () => {
    expect(spotFor(["README.md", "src/export.ts:1"], hunksOf)).toEqual({ file: "src/export.ts", line: 1 });
    expect(spotFor(["README.md"], hunksOf)).toBeNull();
  });
  it("asks in the reader's voice, with the AI's reading", () => {
    expect(questionFor({ id: "d1", title: "Stream the rows", what: "rows go out as read", agentWhy: "the exports time out", where: [] })).toBe(
      "Checking an assumption: \"Stream the rows\" — rows go out as read\n\nMy reading: the exports time out\n\nIs that the reason?",
    );
  });
});
