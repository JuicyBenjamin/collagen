import { describe, expect, it } from "vitest";
import type { Ticket } from "@collagen/p2p";
import { closedLine, relationsOf, tabLabel, TICKET_TABS } from "./ticketTabs";

const t = (over: Partial<Ticket>): Ticket => ({ id: "t", project: "collagen", goal: "g", createdBy: "alice", kind: "task", steps: [], structureAt: 1, updatedAt: 1, ...over });

describe("the ticket list's tabs", () => {
  it("all tickets, then a tab per kind with its glyph", () => {
    expect(TICKET_TABS[0]).toBe("all");
    expect(tabLabel("all")).toBe("all tickets");
    expect(tabLabel("bug")).toBe("⚑ bugs");
    expect(tabLabel("epic")).toBe("♛ epics");
  });

  it("a row's relations: its epic, what it grew out of, and how many grew out of it", () => {
    const epic = t({ id: "e", kind: "epic", title: "More languages" });
    const parent = t({ id: "p", kind: "proposal", title: "PHP" });
    const me = t({ id: "m", kind: "plan", from: ["p"], partOf: [{ id: "x", epic: "e", by: "alice", at: 1 }] });
    const kid = t({ id: "k", from: ["m"] });
    const all = new Map([epic, parent, me, kid].map((x) => [x.id, x]));
    expect(relationsOf(me, all)).toEqual({ epic: { id: "e", name: "More languages" }, parent: { id: "p", name: "PHP" }, children: 1 });
    expect(relationsOf(parent, all)).toEqual({ children: 1 });
  });

  it("a closed ticket says how it ended", () => {
    expect(closedLine(t({}))).toBeNull();
    expect(closedLine(t({ closed: { by: "alice", ts: 2, outcome: "dropped", reason: "superseded" } }))).toBe("dropped: superseded");
    expect(closedLine(t({ closed: { by: "alice", ts: 2 } }))).toBe("closed as done");
  });
});
