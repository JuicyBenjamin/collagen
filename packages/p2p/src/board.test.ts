import { describe, expect, it } from "vitest";
import { boardColumn } from "./board";
import { closeTicket, moveToEpic, type StepStatus, type Ticket } from "./ticket";

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t",
  project: "collagen",
  goal: "g",
  createdBy: "alice",
  kind: "task",
  steps: [],
  structureAt: 1,
  updatedAt: 1,
  ...over,
});
const withSteps = (id: string, ...statuses: ReadonlyArray<StepStatus>): Ticket =>
  ticket({ id, steps: statuses.map((status, index) => ({ id: `s${index}`, owner: "bob", intent: "do", description: "d", needs: [], status, updatedAt: 1 })) });
const room = (...tickets: ReadonlyArray<Ticket>) => new Map(tickets.map((ticket) => [ticket.id, ticket]));
const column = (ticket: Ticket, ...rest: ReadonlyArray<Ticket>) => boardColumn(ticket, room(ticket, ...rest));

describe("a ticket's column", () => {
  it("is to do with no steps, or none taken up", () => {
    expect(column(ticket({}))).toBe("todo");
    expect(column(withSteps("t", "pending", "pending"))).toBe("todo");
  });

  it("a withdrawn step is not anyone starting", () => {
    expect(column(withSteps("t", "retired", "pending"))).toBe("todo");
  });

  it("is in progress once a step is handed over, answered or failed", () => {
    expect(column(withSteps("t", "suspended", "pending"))).toBe("doing");
    expect(column(withSteps("t", "settled", "pending"))).toBe("doing");
    expect(column(withSteps("t", "failed"))).toBe("doing");
  });

  it("is done when every step is answered, closed or not", () => {
    expect(column(withSteps("t", "settled", "retired"))).toBe("done");
  });

  it("is done when closed, however far it got", () => {
    const dropped = closeTicket(withSteps("t", "pending"), "alice", "not needed", 2, "dropped").ticket;
    expect(column(dropped)).toBe("done");
  });
});

describe("an epic's column is its parts'", () => {
  const epic = ticket({ id: "e1", kind: "epic", goal: "more languages" });
  const into = (ticket: Ticket) => moveToEpic(ticket, "e1", "bob", 10);

  it("to do while every part is", () => {
    expect(column(epic)).toBe("todo");
    expect(column(epic, into(withSteps("a", "pending")))).toBe("todo");
  });

  it("in progress once one part is past to do", () => {
    expect(column(epic, into(withSteps("a", "pending")), into(withSteps("b", "settled")))).toBe("doing");
  });

  it("a dropped part is no one starting it", () => {
    const dropped = closeTicket(into(withSteps("b", "pending")), "alice", "not needed", 11, "dropped").ticket;
    expect(column(epic, into(withSteps("a", "pending")), dropped)).toBe("todo");
  });

  it("done when every part it counts is", () => {
    expect(column(epic, into(withSteps("a", "settled")), into(withSteps("b", "settled")))).toBe("done");
  });
});
