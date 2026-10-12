import { describe, expect, it } from "vitest";
import { asksForChanges, readStrength, withStrength } from "./strength";

describe("comment strength", () => {
  it("reads a prefix back, whoever wrote it", () => {
    expect(readStrength("nit: trailing space")).toEqual({ strength: "nit", text: "trailing space" });
    expect(readStrength("Must: this leaks the token")).toEqual({ strength: "must", text: "this leaks the token" });
    expect(readStrength("suggest:\n```suggestion\nx\n```")).toEqual({ strength: "suggest", text: "```suggestion\nx\n```" });
  });

  it("leaves words without one as they are", () => {
    expect(readStrength("must we do this?")).toEqual({ strength: null, text: "must we do this?" });
    expect(readStrength("Note: fine")).toEqual({ strength: null, text: "Note: fine" });
  });

  it("puts one in front, replacing any there", () => {
    expect(withStrength("wish", "rename it")).toBe("wish: rename it");
    expect(withStrength("must", "nit: rename it")).toBe("must: rename it");
    expect(withStrength(null, "rename it")).toBe("rename it");
    expect(readStrength(withStrength("suggest", "a\nb"))).toEqual({ strength: "suggest", text: "a\nb" });
  });

  it("only a must asks for changes", () => {
    expect(asksForChanges("must: fix")).toBe(true);
    expect(asksForChanges("wish: fix")).toBe(false);
    expect(asksForChanges("fix")).toBe(false);
  });
});
