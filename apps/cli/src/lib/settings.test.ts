import { describe, expect, it } from "vitest";
import { describeSettings, SETTINGS, settingOf, withSetting } from "./settings";

describe("the person's switches", () => {
  it("reads a switch never set as its default", () => {
    expect(settingOf({}, "openReviewPage")).toBe(true);
    expect(settingOf({ settings: {} }, "openReviewPage")).toBe(true);
  });

  it("keeps what was set, beside the others", () => {
    const off = withSetting({ settings: {} }, "openReviewPage", false);
    expect(settingOf(off, "openReviewPage")).toBe(false);
    expect(settingOf(withSetting(off, "openReviewPage", true), "openReviewPage")).toBe(true);
  });

  it("tells the agent every switch, where it stands and what that means", () => {
    const lines = describeSettings({}).split("\n");
    expect(lines).toHaveLength(SETTINGS.length);
    expect(lines[0]).toMatch(/^openReviewPage: on \(default\) — /);
    expect(describeSettings({ settings: { openReviewPage: false } })).toMatch(/^openReviewPage: off — the review page opens only when you ask/);
  });
});
