import { describe, expect, it } from "vitest";
import type { Ticket } from "@collagen/p2p";
import { closedLine, fitTabs, relationsOf, relativesOf, tabLabel, TICKET_TABS } from "./ticketTabs";

const ticketOf = (over: Partial<Ticket>): Ticket => ({ id: "t", project: "collagen", goal: "g", createdBy: "alice", kind: "task", steps: [], structureAt: 1, updatedAt: 1, ...over });

describe("the ticket list's tabs", () => {
  it("all tickets, then a tab per kind with its glyph", () => {
    expect(TICKET_TABS[0]).toBe("all");
    expect(tabLabel("all")).toBe("all tickets");
    expect(tabLabel("bug")).toBe("⚑ bugs");
    expect(tabLabel("epic")).toBe("♛ epics");
  });

  it("a row's relations: its epic, what it grew out of, and its relatives either way", () => {
    const epic = ticketOf({ id: "e", kind: "epic", title: "More languages" });
    const parent = ticketOf({ id: "p", kind: "proposal", title: "PHP" });
    const me = ticketOf({ id: "m", kind: "plan", from: ["p"], partOf: [{ id: "x", epic: "e", by: "alice", at: 1 }] });
    const kid = ticketOf({ id: "k", from: ["m"] });
    const all = new Map([epic, parent, me, kid].map((ticket) => [ticket.id, ticket]));
    expect(relationsOf(me, all, "alice")).toEqual({ epic: { id: "e", name: "More languages" }, parent: { id: "p", name: "PHP" } });
    expect(relativesOf(me, all, "alice").map((relative) => [relative.ticket.id, relative.as])).toEqual([["p", "parent"], ["k", "child"]]);
    expect(relativesOf(parent, all, "alice").map((relative) => [relative.ticket.id, relative.as])).toEqual([["m", "child"]]);
  });

  it("names, shows and opens only what the reader may see: a ticket waiting on another is its author's alone", () => {
    const blocker = ticketOf({ id: "b", kind: "plan", title: "Blocker", createdBy: "bob" });
    // carol's ticket waits on the blocker: nobody but carol sees it yet
    const gatedParent = ticketOf({ id: "g", kind: "proposal", title: "Secret plan", createdBy: "carol", after: ["b"] });
    const child = ticketOf({ id: "c", from: ["g"], createdBy: "alice" });
    const gatedChild = ticketOf({ id: "gc", from: ["c"], createdBy: "carol", after: ["b"] });
    const all = new Map([blocker, gatedParent, child, gatedChild].map((ticket) => [ticket.id, ticket]));
    // to alice: no hidden parent, no hidden descendant
    expect(relationsOf(child, all, "alice")).toEqual({});
    expect(relativesOf(child, all, "alice")).toEqual([]);
    // to carol, their author: both are there
    expect(relationsOf(child, all, "carol")).toEqual({ parent: { id: "g", name: "Secret plan" } });
    expect(relativesOf(child, all, "carol").map((relative) => [relative.ticket.id, relative.as])).toEqual([["g", "parent"], ["gc", "child"]]);
  });

  it("a closed ticket says how it ended", () => {
    expect(closedLine(ticketOf({}))).toBeNull();
    expect(closedLine(ticketOf({ closed: { by: "alice", ts: 2, outcome: "dropped", reason: "superseded" } }))).toBe("⊗ superseded");
    expect(closedLine(ticketOf({ closed: { by: "alice", ts: 2 } }))).toBe("✓");
  });
});

describe("the tabs in a narrow pane", () => {
  const counts = new Map(TICKET_TABS.map((tab) => [tab, tab === "all" ? 12 : tab === "task" ? 3 : tab === "proposal" ? 9 : 0]));
  const row = (fitted: ReturnType<typeof fitTabs>) => `${fitted.before ? "‹ " : ""}${fitted.tabs.map((drawn) => (drawn.open ? `[${drawn.text}]` : drawn.text)).join(" ")}${fitted.after ? " ›" : ""}`;

  it("all of them, when they fit", () => {
    expect(row(fitTabs("all", counts, 120))).toBe("[all tickets 12] ♛ epics 0 ✦ proposals 9 ⚑ bugs 0 ≡ plans 0 ☐ tasks 3 ± reviews 0");
  });

  it("the open one whole, the others by glyph, when they do not", () => {
    expect(row(fitTabs("epic", counts, 50))).toBe("all 12 [♛ epics 0] ✦ 9 ⚑ 0 ≡ 0 ☐ 3 ± 0");
  });

  it("a window around the open one, marked where cut — the open one always named", () => {
    const fitted = fitTabs("bug", counts, 24);
    expect(fitted.tabs.find((drawn) => drawn.open)?.text).toBe("⚑ bugs 0");
    expect(fitted.before || fitted.after).toBe(true);
    expect(row(fitted).length).toBeLessThanOrEqual(26);
    // at the very left, nothing before
    expect(fitTabs("all", counts, 24).before).toBe(false);
  });
});
