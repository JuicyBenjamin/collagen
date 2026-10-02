import { describe, expect, it } from "vitest";
import { moveToEpic, type Ticket } from "@collagen/p2p";
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
});
