import { describe, expect, it } from "vitest";
import type { Ticket } from "@collagen/p2p";
import { openParents } from "./parents";

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, project: "shop", goal: id, title: `Title ${id}`, createdBy: "me", kind: "plan", steps: [], structureAt: 1, updatedAt: 1, ...over });

describe("what a closed ticket grew from", () => {
  it("offers only what is still open and the person's own to close", () => {
    const all = new Map<string, Ticket>([
      ["plan", ticket("plan")],
      ["done", ticket("done", { closed: { by: "me", ts: 1, outcome: "done" } })],
      ["theirs", ticket("theirs", { createdBy: "bob" })],
      ["epic", ticket("epic", { kind: "epic" })],
    ]);
    const review = ticket("review", { kind: "review", from: ["plan", "done", "theirs", "epic", "gone"] });
    expect(openParents(review, all, "me")).toEqual([{ id: "plan", title: "Title plan" }]);
  });

  it("offers nothing for a ticket that grew from nothing", () => {
    expect(openParents(ticket("review", { kind: "review" }), new Map(), "me")).toEqual([]);
  });
});
