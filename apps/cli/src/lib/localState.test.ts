import { describe, expect, it } from "vitest";
import { salvageState } from "./localState";

const rooms = { "st-test3": [{ id: "p1", name: "sandbox", path: "/work/sandbox" }] };
const proposal = (over: Record<string, unknown> = {}) => ({
  id: "p-1",
  roomId: "st-test3",
  to: "bob",
  title: "sandbox · ask",
  ts: 1,
  outgoing: { kind: "message", peer: "bob", project: "sandbox", intent: "ask", findings: "why NaN?" },
  ...over,
});

describe("reading the user's state file", () => {
  it("a whole file is taken as it is", () => {
    const { state, dropped } = salvageState(JSON.stringify({ preferredAi: "codex", rooms, outbox: [proposal()] }));
    expect(dropped).toEqual([]);
    expect(state.preferredAi).toBe("codex");
    expect(state.rooms["st-test3"]).toHaveLength(1);
    expect(state.outbox).toHaveLength(1);
  });

  it("a proposal from an older build is dropped — the rooms are not", () => {
    // a ticket in the pre-kind shape: it no longer decodes
    const stale = proposal({ id: "p-old", outgoing: { kind: "ticket", ticket: { id: "t", project: "sandbox", goal: "g", createdBy: "me", updatedAt: 1, steps: [] } } });
    const { state, dropped } = salvageState(JSON.stringify({ preferredAi: null, rooms, threads: { abc: { ai: "codex", sessionId: "s", since: 1 } }, outbox: [stale, proposal()] }));
    expect(dropped).toEqual(["1 queued proposal"]);
    expect(state.rooms["st-test3"]?.[0]?.name).toBe("sandbox");
    expect(state.threads?.abc?.sessionId).toBe("s");
    expect(state.outbox?.map((p) => p.id)).toEqual(["p-1"]);
  });

  it("one broken project does not take the room's others with it", () => {
    const { state, dropped } = salvageState(
      JSON.stringify({ preferredAi: null, rooms: { r1: [{ id: "p1", name: "sandbox", path: "/work" }, { name: "no id" }] } }),
    );
    expect(dropped).toEqual(["1 shared project"]);
    expect(state.rooms["r1"]?.map((p) => p.name)).toEqual(["sandbox"]);
  });

  it("junk is junk: a fresh state, and it says so", () => {
    expect(salvageState("not json").dropped[0]).toMatch(/not readable JSON/);
    expect(salvageState("[]").dropped[0]).toMatch(/not a state file/);
    expect(salvageState("not json").state).toEqual({ preferredAi: null, rooms: {} });
  });
});
