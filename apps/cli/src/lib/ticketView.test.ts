import { describe, expect, it } from "vitest";
import { emptyReview, moveToEpic, turnEpic, type Ticket } from "@collagen/p2p";
import { ticketRow, ticketView } from "./ticketView";

const ticketOf = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, project: "collagen", goal: id, createdBy: "alice", kind: "task", steps: [], structureAt: 1, updatedAt: 1, ...over });
const pending = [{ id: "s", owner: "alice", intent: "do", description: "d", needs: [], status: "pending" as const, updatedAt: 1 }];

describe("an epic in get-ticket, per reader", () => {
  it("lists only the tickets this reader may be shown; the count stays the room's", () => {
    const epic = ticketOf("e1", { kind: "epic", project: "", goal: "More languages" });
    const first = moveToEpic(ticketOf("first", { steps: pending }), "e1", "alice", 1);
    // waits on `first`: alice's alone until it is answered
    const second = moveToEpic(ticketOf("second", { steps: pending, after: ["first"] }), "e1", "alice", 2);
    const all = new Map([epic, first, second].map((ticket) => [ticket.id, ticket]));
    const forBob = ticketView(epic, (key) => key, undefined, [], all, "bob");
    expect(forBob.parts).toBe("0 of 2 pieces of work done: first");
    expect(forBob.unresolved).toBe("first");
    const forAlice = ticketView(epic, (key) => key, undefined, [], all, "alice");
    expect(forAlice.parts).toBe("0 of 2 pieces of work done: first second");
  });

  it("a close that missed a gated addition: the reason never names what the reader may not see", () => {
    const epic = ticketOf("e1", { kind: "epic", project: "", goal: "More languages" });
    const closed = turnEpic(epic, true, undefined, "alice", new Map([[epic.id, epic]]), 5).ticket;
    const gate = ticketOf("gate", { steps: pending });
    const secret = moveToEpic(ticketOf("secret", { goal: "Secret gated work", steps: pending, after: ["gate"] }), "e1", "alice", 6);
    const all = new Map([closed, gate, secret].map((ticket) => [ticket.id, ticket]));
    const bob = ticketView(closed, (key) => key, undefined, [], all, "bob");
    expect(bob.closed).toBe(false);
    expect(bob.openBecause).toMatch(/^a ticket you are not shown yet was put in without the close seeing it/);
    expect(JSON.stringify(bob)).not.toMatch(/Secret/);
    expect(ticketView(closed, (key) => key, undefined, [], all, "alice").openBecause).toMatch(/"Secret gated work"/);
  });
});

describe("a ticket's row in get-tickets", () => {
  const names = (key: string) => ({ alice: "Alice", bob: "Bob" })[key] ?? key;
  const step = (id: string, owner: string, status: "pending" | "settled", needs: Array<string> = []) => ({ id, owner, intent: "do", description: "a long description the row leaves out", needs, status, updatedAt: 1 });

  it("says where it stands and whose move it is, without its steps", () => {
    const working = ticketOf("work", { title: "Exports finish", goal: "Rows stream", steps: [step("s1", "bob", "settled"), step("s2", "alice", "pending", ["s1"]), step("s3", "bob", "pending", ["s2"])] });
    const all = new Map([[working.id, working]]);
    expect(ticketRow(working, names, [], all)).toEqual({ id: "work", kind: "task", title: "Exports finish", subtitle: "Rows stream", status: "open", waitingOn: "Alice", epic: "" });
    expect(JSON.stringify(ticketRow(working, names, [], all))).not.toMatch(/long description/);
  });

  it("answered once every step is, held while it waits on another, closed with nobody's move left", () => {
    const done = ticketOf("done", { steps: [step("s1", "bob", "settled")] });
    const held = ticketOf("held", { steps: [step("s1", "bob", "pending")], after: ["done"] });
    const closed = ticketOf("closed", { steps: [step("s1", "bob", "pending")], closed: { by: "alice", ts: 2, outcome: "dropped" } });
    const all = new Map([done, held, closed].map((ticket) => [ticket.id, ticket]));
    expect(ticketRow(done, names, [], all).status).toBe("answered");
    expect(ticketRow(held, names, ["done"], all).status).toBe("held");
    expect(ticketRow(closed, names, [], all)).toMatchObject({ status: "closed", waitingOn: "" });
  });

  it("a review's line beneath its title is its summary, not its branch", () => {
    const review = ticketOf("r1", { kind: "review", goal: "review lean-get-tickets", steps: [] });
    const all = new Map([[review.id, review]]);
    const why = { ...emptyReview("r1", "alice", "Alice"), summary: "The list is short" };
    expect(ticketRow(review, names, [], all, why).subtitle).toBe("The list is short");
    expect(ticketRow(review, names, [], all).subtitle).toBe("review lean-get-tickets");
  });

  it("an epic's status says how far along it is; a part names its epic", () => {
    const epic = ticketOf("e1", { kind: "epic", project: "", goal: "More languages" });
    const part = moveToEpic(ticketOf("part", { steps: [step("s1", "bob", "settled")] }), "e1", "alice", 1);
    const all = new Map([epic, part].map((ticket) => [ticket.id, ticket]));
    expect(ticketRow(epic, names, [], all).status).toBe("open · 1 of 1 done");
    expect(ticketRow(part, names, [], all).epic).toBe("e1");
  });
});
