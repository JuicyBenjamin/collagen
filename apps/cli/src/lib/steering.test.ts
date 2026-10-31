import { describe, expect, it } from "vitest";
import type { SteeringLevels } from "@collagen/p2p";
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

  it("a room that sets its own level stands over everywhere there, and only there", () => {
    const everywhere = withLevel(withLevel({}, "master", "mine", "ask"), "investigate", "mine", "act");
    const room = withLevel(everywhere, "investigate", "mine", "never", "room-a");
    expect(levelOf(room, "investigate", "mine", "room-a")).toBe("never");
    expect(levelOf(room, "investigate", "mine", "room-b")).toBe("act");
    expect(levelOf(room, "investigate", "mine")).toBe("act");
    // a kind the room does not set follows everywhere's for that kind
    expect(levelOf(room, "host", "mine", "room-a")).toBe("ask");
  });

  it("a room's general level stands over every kind set everywhere, until the room sets that kind", () => {
    const everywhere = withLevel({}, "host", "mine", "auto");
    const quiet = withLevel(everywhere, "master", "mine", "never", "room-a");
    expect(levelOf(quiet, "host", "mine", "room-a")).toBe("never");
    expect(levelOf(withLevel(quiet, "host", "mine", "ask", "room-a"), "host", "mine", "room-a")).toBe("ask");
    expect(allow(quiet, "host", "mine", false, "room-a")).toMatchObject({ held: "never" });
    expect(allow(quiet, "host", "mine", false, "room-b")).toHaveProperty("go");
  });

  it("a room given back follows everywhere again, and leaves nothing behind", () => {
    const set = withLevel(withLevel({ steering: {} as SteeringLevels }, "deliver", "others", "act", "room-a"), "master", "mine", "ask", "room-a");
    const back = withLevel(withLevel(set, "deliver", "others", null, "room-a"), "master", "mine", null, "room-a");
    expect(levelOf(back, "deliver", "others", "room-a")).toBe("unset");
    expect(back.steering?.rooms).toBeUndefined();
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

  it("never does nothing on its own and asks nothing, but the person's own word goes through", () => {
    const never = withLevel({}, "investigate", "mine", "never");
    expect(allow(never, "investigate", "mine")).toMatchObject({ held: "never" });
    expect(allow(never, "investigate", "mine", true)).toHaveProperty("go");
    expect(steeringLine("never")).toMatch(/do not start on this, and do not offer to/);
  });

  it("the dial starts at the asking end and goes round ask → act → auto → never", () => {
    expect([nextSteering("unset"), nextSteering("ask"), nextSteering("act"), nextSteering("auto"), nextSteering("never")]).toEqual(["ask", "act", "auto", "never", "ask"]);
  });

  it("no level speaks for the person in the room", () => {
    for (const level of ["act", "auto"] as const) expect(steeringLine(level)).toMatch(/said in the room for your user .* still waits for their word/);
  });
});
