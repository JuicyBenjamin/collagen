import { describe, expect, it } from "vitest";
import type { Ticket } from "@collagen/p2p";
import { closedLine, fitTabs, relationsOf, tabLabel, TICKET_TABS } from "./ticketTabs";

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
    expect(relationsOf(me, all, "alice")).toEqual({ epic: { id: "e", name: "More languages" }, parent: { id: "p", name: "PHP" }, children: 1 });
    expect(relationsOf(parent, all, "alice")).toEqual({ children: 1 });
  });

  it("names, counts and opens only what the reader may see: a ticket waiting on another is its author's alone", () => {
    const blocker = t({ id: "b", kind: "plan", title: "Blocker", createdBy: "bob" });
    // carol's ticket waits on the blocker: nobody but carol sees it yet
    const gatedParent = t({ id: "g", kind: "proposal", title: "Secret plan", createdBy: "carol", after: ["b"] });
    const child = t({ id: "c", from: ["g"], createdBy: "alice" });
    const gatedChild = t({ id: "gc", from: ["c"], createdBy: "carol", after: ["b"] });
    const all = new Map([blocker, gatedParent, child, gatedChild].map((x) => [x.id, x]));
    // to alice: no hidden parent, no hidden descendant counted
    expect(relationsOf(child, all, "alice")).toEqual({ children: 0 });
    // to carol, their author: both are there
    expect(relationsOf(child, all, "carol")).toEqual({ parent: { id: "g", name: "Secret plan" }, children: 1 });
  });

  it("a closed ticket says how it ended", () => {
    expect(closedLine(t({}))).toBeNull();
    expect(closedLine(t({ closed: { by: "alice", ts: 2, outcome: "dropped", reason: "superseded" } }))).toBe("dropped: superseded");
    expect(closedLine(t({ closed: { by: "alice", ts: 2 } }))).toBe("closed as done");
  });
});

describe("the tabs in a narrow pane", () => {
  const counts = new Map(TICKET_TABS.map((t) => [t, t === "all" ? 12 : t === "task" ? 3 : t === "proposal" ? 9 : 0]));
  const row = (r: ReturnType<typeof fitTabs>) => `${r.before ? "‹ " : ""}${r.tabs.map((d) => (d.open ? `[${d.text}]` : d.text)).join(" ")}${r.after ? " ›" : ""}`;

  it("all of them, when they fit", () => {
    expect(row(fitTabs("all", counts, 120))).toBe("[all tickets 12] ♛ 0 ✦ proposals 9 ≡ 0 ⚑ 0 ± 0 ☐ tasks 3");
  });

  it("the open one whole, the others by glyph, when they do not", () => {
    expect(row(fitTabs("epic", counts, 50))).toBe("all 12 [♛ epics 0] ✦ 9 ≡ 0 ⚑ 0 ± 0 ☐ 3");
  });

  it("a window around the open one, marked where cut — the open one always named", () => {
    const r = fitTabs("bug", counts, 24);
    expect(r.tabs.find((d) => d.open)?.text).toBe("⚑ bugs 0");
    expect(r.before || r.after).toBe(true);
    expect(row(r).length).toBeLessThanOrEqual(26);
    // at the very left, nothing before
    expect(fitTabs("all", counts, 24).before).toBe(false);
  });
});
