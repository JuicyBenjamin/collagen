import { describe, expect, it } from "vitest";
import { actionableSteps, mergeTicket, type Ticket, type TicketStep } from "./ticket";

const step = (over: Partial<TicketStep>): TicketStep => ({
  id: "s1",
  owner: "alice",
  intent: "review",
  description: "look at it",
  needs: [],
  status: "pending",
  updatedAt: 1,
  ...over,
});

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t1",
  threadId: "th1",
  project: "sandbox",
  goal: "fix average()",
  createdBy: "alice",
  steps: [],
  updatedAt: 1,
  ...over,
});

describe("mergeTicket", () => {
  it("unions steps by id", () => {
    const a = ticket({ steps: [step({ id: "s1" })] });
    const b = ticket({ steps: [step({ id: "s2", owner: "bob" })], updatedAt: 2 });
    const m = mergeTicket(a, b);
    expect(m.steps.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("a settled step beats a pending one regardless of timestamps", () => {
    const a = ticket({ steps: [step({ status: "pending", updatedAt: 99 })] });
    const b = ticket({ steps: [step({ status: "settled", result: "done", updatedAt: 2 })] });
    expect(mergeTicket(a, b).steps[0]!.status).toBe("settled");
    expect(mergeTicket(b, a).steps[0]!.status).toBe("settled");
  });

  it("equal rank resolves by updatedAt, and merge is commutative", () => {
    const a = ticket({ steps: [step({ status: "settled", result: "old", updatedAt: 1 })] });
    const b = ticket({ steps: [step({ status: "settled", result: "new", updatedAt: 2 })] });
    expect(mergeTicket(a, b).steps[0]!.result).toBe("new");
    expect(mergeTicket(b, a).steps[0]!.result).toBe("new");
  });

  it("converges regardless of arrival order (associative over three writers)", () => {
    const base = ticket({ steps: [step({ id: "s1" }), step({ id: "s2", owner: "bob" })] });
    const fromBob = ticket({ steps: [step({ id: "s2", owner: "bob", status: "settled", result: "bob did it", updatedAt: 5 })] });
    const fromCarol = ticket({ steps: [step({ id: "s1", status: "failed", result: "cannot", updatedAt: 4 })] });
    const ab = mergeTicket(mergeTicket(base, fromBob), fromCarol);
    const ba = mergeTicket(mergeTicket(base, fromCarol), fromBob);
    const norm = (x: Ticket) => JSON.stringify([...x.steps].sort((p, q) => p.id.localeCompare(q.id)));
    expect(norm(ab)).toBe(norm(ba));
  });

  it("ignores a different ticket id", () => {
    const a = ticket({});
    const b = ticket({ id: "other", steps: [step({})] });
    expect(mergeTicket(a, b).steps).toHaveLength(0);
  });
});

describe("actionableSteps", () => {
  it("returns own unsettled steps whose needs are settled", () => {
    const t = ticket({
      steps: [
        step({ id: "a", owner: "bob", status: "settled" }),
        step({ id: "b", owner: "me", needs: ["a"], status: "pending" }),
        step({ id: "c", owner: "me", needs: ["missing"], status: "pending" }),
        step({ id: "d", owner: "other", status: "pending" }),
        step({ id: "e", owner: "me", status: "settled" }),
      ],
    });
    expect(actionableSteps(t, "me").map((s) => s.id)).toEqual(["b"]);
  });
});
