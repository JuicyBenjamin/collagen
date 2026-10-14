import { describe, expect, it } from "vitest";
import { migrateOp, migrateRow, readTicket } from "./migrate";

const olderTicket = {
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
    const read = readTicket(olderTicket);
    expect(read?.migrated).toBe(true);
    expect(read?.value.structureAt).toBe(7);
    expect(read?.value.goal).toBe("fix average()");
  });

  it("a current ticket is read as it is", () => {
    const read = readTicket({ ...olderTicket, structureAt: 9 });
    expect(read?.migrated).toBe(false);
    expect(read?.value.structureAt).toBe(9);
  });

  it("what no shape we know can read is nothing — and gets evicted upstream", () => {
    expect(readTicket({ ...olderTicket, steps: [{ ...olderTicket.steps[0], status: "bogus" }] })).toBe(null);
    expect(readTicket("not a ticket")).toBe(null);
    expect(migrateRow("member", { key: "k" })).toBe(null); // no older member shape exists
  });

  it("a log entry carrying an old ticket is migrated as an entry", () => {
    expect(migrateOp({ op: "ticket", ticket: olderTicket })?.ticket.structureAt).toBe(7);
    expect(migrateOp({ op: "rename", name: "x", ts: 1 })).toBe(null);
  });
});
