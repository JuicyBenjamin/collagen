import { describe, expect, it } from "vitest";
import { moveToEpic, turnEpic, type Ticket } from "@collagen/p2p";
import { ticketView } from "./ticketView";

const t = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, project: "collagen", goal: id, createdBy: "alice", kind: "task", steps: [], structureAt: 1, updatedAt: 1, ...over });
const pending = [{ id: "s", owner: "alice", intent: "do", description: "d", needs: [], status: "pending" as const, updatedAt: 1 }];

describe("an epic in get-tickets, per reader", () => {
  it("lists only the tickets this reader may be shown; the count stays the room's", () => {
    const epic = t("e1", { kind: "epic", project: "", goal: "More languages" });
    const first = moveToEpic(t("first", { steps: pending }), "e1", "alice", 1);
    // waits on `first`: alice's alone until it is answered
    const second = moveToEpic(t("second", { steps: pending, after: ["first"] }), "e1", "alice", 2);
    const all = new Map([epic, first, second].map((x) => [x.id, x]));
    const forBob = ticketView(epic, (k) => k, undefined, [], all, "bob");
    expect(forBob.parts).toBe("0 of 2 done: first");
    expect(forBob.unresolved).toBe("first");
    const forAlice = ticketView(epic, (k) => k, undefined, [], all, "alice");
    expect(forAlice.parts).toBe("0 of 2 done: first second");
  });

  it("a close that missed a gated addition: the reason never names what the reader may not see", () => {
    const epic = t("e1", { kind: "epic", project: "", goal: "More languages" });
    const closed = turnEpic(epic, true, undefined, "alice", new Map([[epic.id, epic]]), 5).ticket;
    const gate = t("gate", { steps: pending });
    const secret = moveToEpic(t("secret", { goal: "Secret gated work", steps: pending, after: ["gate"] }), "e1", "alice", 6);
    const all = new Map([closed, gate, secret].map((x) => [x.id, x]));
    const bob = ticketView(closed, (k) => k, undefined, [], all, "bob");
    expect(bob.closed).toBe(false);
    expect(bob.openBecause).toMatch(/^a ticket you are not shown yet was put in without the close seeing it/);
    expect(JSON.stringify(bob)).not.toMatch(/Secret/);
    expect(ticketView(closed, (k) => k, undefined, [], all, "alice").openBecause).toMatch(/"Secret gated work"/);
  });
});
