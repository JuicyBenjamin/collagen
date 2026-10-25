import { describe, expect, it } from "vitest";
import { allow, levelOf, nextSteering, steeringLine, withLevel } from "./steering";
import { salvageState } from "./localState";

describe("steering", () => {
  it("with nothing chosen, nothing is done outside collagen, and the agent asks", () => {
    expect(allow({}, "host", "mine")).toMatchObject({ held: "unset" });
    expect(allow({}, "deliver", "mine")).toMatchObject({ held: "unset" });
    expect(steeringLine(levelOf({}, "work", "mine"))).toMatch(/do not start on this.*wait for their word/);
  });

  it("a kind follows the master until it is set itself", () => {
    const master = withLevel({}, "master", "mine", "act");
    expect(levelOf(master, "host", "mine")).toBe("act");
    expect(levelOf(withLevel(master, "host", "mine", "ask"), "host", "mine")).toBe("ask");
    expect(levelOf(withLevel(withLevel(master, "host", "mine", "ask"), "host", "mine", null), "host", "mine")).toBe("act");
  });

  it("what someone else caused never follows the person's own level", () => {
    const trusting = withLevel(withLevel({}, "master", "mine", "auto"), "host", "mine", "auto");
    expect(allow(trusting, "host", "others")).toMatchObject({ held: "unset" });
    expect(allow(trusting, "deliver", "others")).toMatchObject({ held: "unset" });
    expect(allow(withLevel(trusting, "deliver", "others", "act"), "deliver", "others")).toHaveProperty("go");
  });

  it("ask first lets an act through only on the person's yes, and not chosen never does", () => {
    const asking = withLevel({}, "host", "mine", "ask");
    expect(allow(asking, "host", "mine")).toMatchObject({ held: "ask" });
    expect(allow(asking, "host", "mine", true)).toHaveProperty("go");
    expect(allow({}, "host", "mine", true)).toMatchObject({ held: "unset" });
    expect(allow(withLevel({}, "host", "mine", "act"), "host", "mine")).toHaveProperty("go");
  });

  it("an older build's one level was the work level, and chose nothing about acting outside", () => {
    const { state, dropped } = salvageState(JSON.stringify({ preferredAi: null, rooms: {}, steering: "auto" }));
    expect(dropped).toEqual([]);
    expect(levelOf(state, "work", "mine")).toBe("auto");
    expect(allow(state, "host", "mine")).toMatchObject({ held: "unset" });
    expect(allow(state, "deliver", "mine")).toMatchObject({ held: "unset" });
  });

  it("an unreadable steering setting falls back to nothing chosen, and says so", () => {
    const salvaged = salvageState(JSON.stringify({ preferredAi: null, rooms: {}, steering: "yolo" }));
    expect(levelOf(salvaged.state, "work", "mine")).toBe("unset");
    expect(salvaged.dropped.join(" ")).toMatch(/steering/);
  });

  it("the dial starts at the asking end and goes round ask → act → auto", () => {
    expect([nextSteering("unset"), nextSteering("ask"), nextSteering("act"), nextSteering("auto")]).toEqual(["ask", "act", "auto", "ask"]);
  });

  it("no level speaks for the person in the room", () => {
    for (const level of ["act", "auto"] as const) expect(steeringLine(level)).toMatch(/said in the room for your user .* still waits for their word/);
  });
});
