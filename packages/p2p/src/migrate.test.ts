import { describe, expect, it } from "vitest";
import { migrateOp, migrateRow, readTicket } from "./migrate";

const v3 = {
  id: "t1",
  project: "sandbox",
  goal: "fix average()",
  createdBy: "alice",
  kind: "task",
  updatedAt: 7,
  steps: [{ id: "s1", owner: "bob", intent: "investigate", description: "look", needs: [], status: "pending", updatedAt: 1 }],
};

describe("migrate: older shapes become the current one, once, or nothing", () => {
  it("a protocol 2/3 ticket gains the author's clock, set to its last change", () => {
    const r = readTicket(v3);
    expect(r?.migrated).toBe(true);
    expect(r?.value.structureAt).toBe(7);
    expect(r?.value.goal).toBe("fix average()");
  });

  it("a current ticket is read as it is", () => {
    const r = readTicket({ ...v3, structureAt: 9 });
    expect(r?.migrated).toBe(false);
    expect(r?.value.structureAt).toBe(9);
  });

  it("what no shape we know can read is nothing — and gets evicted upstream", () => {
    expect(readTicket({ ...v3, steps: [{ ...v3.steps[0], status: "bogus" }] })).toBe(null);
    expect(readTicket("not a ticket")).toBe(null);
    expect(migrateRow("member", { key: "k" })).toBe(null); // no older member shape exists
  });

  it("a log entry carrying an old ticket is migrated as an entry", () => {
    expect(migrateOp({ op: "ticket", ticket: v3 })?.ticket.structureAt).toBe(7);
    expect(migrateOp({ op: "rename", name: "x", ts: 1 })).toBe(null);
  });
});
