import { describe, expect, it } from "vitest";
import type { Hunk } from "./data";
import { fingerprint, fingerprints, readMarks, viewedState } from "./viewed";

const hunk = (file: string, n: number, text: string): Hunk => ({
  id: `${file}#${n}`,
  file,
  header: "@@",
  newStart: 1,
  newLines: 1,
  lines: [{ kind: "+", text, new: 1 }],
});

describe("a file marked as viewed", () => {
  it("has one fingerprint for all its hunks, and a new one when any line moves", () => {
    const a = [hunk("a.ts", 0, "one"), hunk("a.ts", 1, "two")];
    expect(fingerprint(a)).toBe(fingerprint([hunk("a.ts", 0, "one"), hunk("a.ts", 1, "two")]));
    expect(fingerprint(a)).not.toBe(fingerprint([hunk("a.ts", 0, "one"), hunk("a.ts", 1, "two!")]));
    const all = fingerprints([...a, hunk("b.ts", 0, "x")]);
    expect([...all.keys()]).toEqual(["a.ts", "b.ts"]);
    expect(all.get("a.ts")).toBe(fingerprint(a));
  });

  it("is viewed as it was read, changed once its changes move, unread with no mark", () => {
    expect(viewedState({ "a.ts": { fp: "f1" } }, "a.ts", "f1")).toBe("viewed");
    expect(viewedState({ "a.ts": { fp: "f1", at: "abc1234" } }, "a.ts", "f2")).toBe("changed");
    expect(viewedState({}, "a.ts", "f1")).toBe("unread");
  });

  it("reads marks as stored, the first ones (a fingerprint alone) too", () => {
    expect(readMarks({ "a.ts": "f1", "b.ts": { fp: "f2", at: "abc1234" }, "c.ts": 3 })).toEqual({ "a.ts": { fp: "f1" }, "b.ts": { fp: "f2", at: "abc1234" } });
    expect(readMarks(null)).toEqual({});
  });
});
