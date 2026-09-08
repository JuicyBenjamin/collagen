import { describe, expect, it } from "vitest";
import { isNewer, parseVersion } from "./versions";

describe("isNewer", () => {
  it("compares the numeric tuple first", () => {
    expect(isNewer("0.2.0-alpha", "0.1.1-alpha")).toBe(true);
    expect(isNewer("0.1.2-alpha", "0.1.1-alpha")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.1.1-alpha", "0.2.0-alpha")).toBe(false);
  });
  it("a release beats its own pre-release; labels compare as strings", () => {
    expect(isNewer("0.2.0", "0.2.0-alpha")).toBe(true);
    expect(isNewer("0.2.0-alpha", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0-beta", "0.2.0-alpha")).toBe(true);
    expect(isNewer("0.2.0-alpha", "0.2.0-alpha")).toBe(false);
  });
  it("never claims an update for something it can't read", () => {
    expect(isNewer("latest", "0.1.0-alpha")).toBe(false);
    expect(isNewer("0.2.0", "dev")).toBe(false);
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion("v1.2.3-rc.1+build")).toEqual({ major: 1, minor: 2, patch: 3, pre: "rc.1" });
  });
});
