import { describe, expect, it } from "vitest";
import { afterProblem, gated, heldBy, mergeTicket, visibleTo, type Ticket, type TicketStep } from "./ticket";

const step = (over: Partial<TicketStep>): TicketStep => ({ id: "address", owner: "alice", intent: "address", description: "…", needs: [], status: "pending", updatedAt: 1, ...over });
const review = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  project: "sandbox",
  goal: id,
  createdBy: "alice",
  kind: "review",
  structureAt: 1,
  updatedAt: 1,
  steps: [step({})],
  ...over,
});
const map = (...tickets: Ticket[]) => new Map(tickets.map((ticket) => [ticket.id, ticket]));
const answered = (ticket: Ticket): Ticket => ({ ...ticket, steps: ticket.steps.map((ticketStep) => ({ ...ticketStep, status: "settled" as const })) });

describe("after: tickets in order", () => {
  it("a ticket waits while one it follows is unanswered", () => {
    const first = review("first");
    const second = review("second", { after: ["first"] });
    expect(heldBy(second, map(first, second), "carol")).toEqual(["first"]);
    expect(gated(second, map(answered(first), second), "carol")).toBe(false);
  });

  it("a reader's approval opens the next to them, and only to them; the rest wait for the author", () => {
    const first = review("first", { steps: [step({ id: "review-bob", owner: "bob", intent: "review", status: "settled" }), step({ needs: ["review-bob"] })] });
    const second = review("second", { after: ["first"] });
    expect(gated(second, map(first), "bob")).toBe(false);
    expect(visibleTo(second, map(first, second), "bob")).toBe(true);
    expect(gated(second, map(first), "carol")).toBe(true);
  });

  it("asking for changes, or only commenting, opens nothing", () => {
    const failed = review("first", { steps: [step({ id: "review-bob", owner: "bob", intent: "review", status: "failed" }), step({ needs: ["review-bob"] })] });
    const commented = review("first", { steps: [step({ id: "review-bob", owner: "bob", intent: "review", status: "settled", comment: true }), step({ needs: ["review-bob"] })] });
    expect(gated(review("second", { after: ["first"] }), map(failed), "bob")).toBe(true);
    expect(gated(review("second", { after: ["first"] }), map(commented), "bob")).toBe(true);
  });

  it("a closed predecessor holds nothing back, finished or not", () => {
    const first = review("first", { closed: { by: "alice", ts: 2 } });
    expect(gated(review("second", { after: ["first"] }), map(first), "carol")).toBe(false);
  });

  it("a predecessor this peer does not hold is no gate", () => {
    expect(gated(review("second", { after: ["gone"] }), map(), "carol")).toBe(false);
  });

  it("waits through a chain: the third waits while the first holds the second", () => {
    const all = map(review("first"), review("second", { after: ["first"] }), review("third", { after: ["second"] }));
    expect(gated(all.get("third")!, all, "carol")).toBe(true);
  });

  it("its author sees it while it waits; nobody else does", () => {
    const all = map(review("first"), review("second", { after: ["first"] }));
    expect(visibleTo(all.get("second")!, all, "alice")).toBe(true);
    expect(visibleTo(all.get("second")!, all, "bob")).toBe(false);
  });

  it("after merges as the author's structure, and [] withdraws it", () => {
    const ticket = review("second", { after: ["first"] });
    expect(mergeTicket(ticket, { ...ticket, after: [], structureAt: 2 }).after).toEqual([]);
    expect(mergeTicket(ticket, { ...ticket, structureAt: 0, updatedAt: 9 }).after).toEqual(["first"]);
  });
});

describe("afterProblem: an order that cannot hide a ticket for good", () => {
  const all = map(review("a"), review("b", { after: ["a"] }), review("c", { after: ["b"] }));
  it("refuses an unknown id", () => {
    expect(afterProblem(undefined, ["nope"], all, "alice")).toMatch(/no ticket nope/);
  });
  it("refuses waiting on itself", () => {
    expect(afterProblem("a", ["a"], all, "alice")).toMatch(/itself/);
  });
  it("refuses a cycle, direct or through others", () => {
    expect(afterProblem("a", ["b"], all, "alice")).toMatch(/circle/);
    expect(afterProblem("a", ["c"], all, "alice")).toMatch(/circle/);
  });
  it("refuses someone else's gated ticket: you cannot name what you are not shown", () => {
    const theirs = map(review("x", { createdBy: "bob" }), review("y", { createdBy: "bob", after: ["x"] }));
    expect(afterProblem(undefined, ["y"], theirs, "alice")).toMatch(/no ticket y/);
  });
  it("accepts a plain chain", () => {
    expect(afterProblem(undefined, ["c"], all, "alice")).toBeNull();
    expect(afterProblem("c", ["a", "b"], all, "alice")).toBeNull();
  });
});
