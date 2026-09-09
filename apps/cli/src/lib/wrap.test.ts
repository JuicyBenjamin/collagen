import { describe, expect, it } from "vitest";
import { wrap } from "./wrap";

describe("wrap", () => {
  it("wraps at word boundaries, keeps paragraphs, cuts overlong words", () => {
    expect(wrap("the quick brown fox jumps", 10)).toEqual(["the quick", "brown fox", "jumps"]);
    expect(wrap("one\n\ntwo", 10)).toEqual(["one", "", "two"]);
    expect(wrap("abcdefghijkl x", 5)).toEqual(["abcde", "x"]);
    expect(wrap("", 5)).toEqual([""]);
  });
});
