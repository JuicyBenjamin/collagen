import { describe, expect, it } from "vitest";
import { nextSteering, steeringLine, steeringOf } from "./steering";
import { salvageState } from "./localState";

describe("steering", () => {
  it("is the asking end until the person opts into more", () => {
    expect(steeringOf({})).toBe("ask");
    expect(steeringLine("ask")).toMatch(/do not start on this.*wait for their word/);
  });

  it("cycles ask → act → auto → ask", () => {
    expect([nextSteering("ask"), nextSteering("act"), nextSteering("auto")]).toEqual(["act", "auto", "ask"]);
  });

  it("no level speaks for the person in the room", () => {
    for (const level of ["act", "auto"] as const) expect(steeringLine(level)).toMatch(/said in the room for your user .* still waits for their word/);
  });

  it("an unreadable level in the state file falls back to asking, and says so", () => {
    const s = salvageState(JSON.stringify({ preferredAi: null, rooms: {}, steering: "yolo" }));
    expect(steeringOf(s.state)).toBe("ask");
    expect(s.dropped.join(" ")).toMatch(/steering/);
    expect(salvageState(JSON.stringify({ preferredAi: null, rooms: {}, steering: "auto" })).state.steering).toBe("auto");
  });
});
