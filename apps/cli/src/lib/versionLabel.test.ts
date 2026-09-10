import { describe, expect, it } from "vitest";
import { versionLabel } from "./versionLabel";

describe("the build, as a person reads it", () => {
  it("puts the release stage first", () => {
    expect(versionLabel("0.8.0-alpha")).toBe("Alpha v0.8.0");
    expect(versionLabel("1.2.0-beta")).toBe("Beta v1.2.0");
    // a numbered prerelease keeps the stage, drops the counter
    expect(versionLabel("0.8.1-alpha.3")).toBe("Alpha v0.8.1");
  });

  it("a real release is just its number", () => {
    expect(versionLabel("1.0.0")).toBe("v1.0.0");
  });

  it("and a version we could not read says so — it does not pretend to be a stage", () => {
    expect(versionLabel("unknown")).toBe("unknown");
    expect(versionLabel("")).toBe("unknown");
  });
});
