import { describe, expect, it } from "vitest";
import { troubleOf, type RoomState } from "./roomHealth";

const healthy: RoomState = {
  now: 100_000,
  net: "devnet",
  protocol: "13",
  firewalled: false,
  logOpen: true,
  writable: true,
  awaiting: false,
  refusal: null,
  here: [{ name: "bob", protocol: "13" }],
  away: ["mille"],
  strangers: [],
  otherProtocol: [],
  waiting: [],
  declined: [],
  admitFailed: [],
  open: 1,
  connecting: 0,
};

describe("what keeps a room from working", () => {
  it("is nothing for a room whose members are here and whose log is written", () => {
    expect(troubleOf(healthy)).toBe(null);
  });

  it("is waiting to be let in, with who could do it", () => {
    expect(troubleOf({ ...healthy, awaiting: true, logOpen: false, writable: false })).toEqual({
      what: "Waiting for a member to let you in — 1 member connected.",
      next: "Ask someone who may let people in to open collagen and let you in.",
    });
    expect(troubleOf({ ...healthy, awaiting: true, here: [], firewalled: true })?.next).toBe(
      "Nobody from the room is online: ask a member to open collagen. This machine is not reachable directly, so a member on an open network has to be online.",
    );
  });

  it("names the peer on another protocol before anything that follows from it", () => {
    expect(troubleOf({ ...healthy, writable: false, here: [{ name: "carol", protocol: "12" }] })?.what).toBe("carol runs collagen protocol 12, you run 13: nothing gets through.");
  });

  it("says an admit failed, and how long ago", () => {
    expect(troubleOf({ ...healthy, admitFailed: [{ name: "nina", why: "writer add timed out", at: 40_000 }] })?.what).toBe("Letting nina into the room's log failed 60 s ago: writer add timed out");
  });

  it("is nobody connected only when the swarm has no connection at all", () => {
    expect(troubleOf({ ...healthy, here: [], open: 0 })?.what).toBe("No member of the room is connected (mille away).");
    expect(troubleOf({ ...healthy, here: [], open: 1 })).toBe(null);
  });
});
