import { describe, expect, it } from "vitest";
import { selectionLabel } from "./chatText";

describe("selectionLabel", () => {
  it("names one line or a block", () => {
    expect(selectionLabel({ file: "a.ts", from: { line: 3 }, to: { line: 3 } })).toBe("a.ts:3");
    expect(selectionLabel({ file: "a.ts", from: { line: 3 }, to: { line: 9 } })).toBe("a.ts:3–9");
  });
});
