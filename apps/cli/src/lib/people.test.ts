import { describe, expect, it } from "vitest";
import { fitNames } from "./people";

describe("the people line", () => {
  it("as many names as fit, then room for …", () => {
    expect(fitNames(["you", "bob"], 20)).toEqual({ shown: 2, more: false });
    // "you, bob" is 8; a third would need ", carol" and the " …" reserve
    expect(fitNames(["you", "bob", "carol", "dave"], 12)).toEqual({ shown: 2, more: true });
    expect(fitNames(["averyveryverylongname", "bob"], 5)).toEqual({ shown: 1, more: true });
  });
});
