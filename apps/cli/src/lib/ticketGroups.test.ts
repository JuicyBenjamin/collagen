import { describe, expect, it } from "vitest";
import type { Ticket, TicketKind } from "@collagen/p2p";
import { drawnOrder, groupTickets } from "./ticketGroups";
import type { TicketSummary } from "./ticketSummary";

const row = (id: string, project: string, kind: TicketKind, state: TicketSummary["state"], lastActivity = 1) => ({
  ticket: { id, project, kind } as Ticket,
  summary: { state, lastActivity } as TicketSummary,
});

describe("groupTickets", () => {
  it("groups by project, then by kind in lifecycle order", () => {
    const rows = [row("r", "api", "review", "waiting"), row("t", "api", "task", "waiting"), row("p", "api", "proposal", "waiting"), row("b", "api", "bug", "waiting"), row("l", "api", "plan", "waiting")];
    const [api] = groupTickets(rows);
    expect(api!.kinds.map((kindGroup) => kindGroup.kind)).toEqual(["proposal", "bug", "plan", "task", "review"]);
  });

  it("inside a group, needs you first, then newest activity", () => {
    const rows = [row("old", "api", "plan", "waiting", 1), row("new", "api", "plan", "waiting", 5), row("you", "api", "plan", "needs-you", 0)];
    expect(drawnOrder(groupTickets(rows)).map((entry) => entry.ticket.id)).toEqual(["you", "new", "old"]);
  });

  it("a project holding something for you comes before one that does not", () => {
    const rows = [row("a", "alpha", "plan", "waiting", 9), row("z", "zeta", "review", "needs-you", 1)];
    expect(groupTickets(rows).map((group) => group.project)).toEqual(["zeta", "alpha"]);
  });

  it("projects alike in urgency fall back to newest, then by name", () => {
    const rows = [row("b", "beta", "plan", "waiting", 1), row("a", "alpha", "plan", "waiting", 1)];
    expect(groupTickets(rows).map((group) => group.project)).toEqual(["alpha", "beta"]);
  });
});

describe("stacked tickets inside a group", () => {
  const after = (entry: ReturnType<typeof row>, ...ids: string[]) => ({ ...entry, ticket: { ...entry.ticket, after: ids } as Ticket });

  it("a ticket that follows another is drawn right under it, marked as following", () => {
    const first = row("first", "api", "review", "waiting", 1);
    const other = row("other", "api", "review", "waiting", 5);
    const second = after(row("second", "api", "review", "waiting", 9), "first");
    const [group] = groupTickets([first, other, second]);
    expect(group!.kinds[0]!.rows.map((entry) => entry.ticket.id)).toEqual(["other", "first", "second"]);
    expect(group!.kinds[0]!.depth.get("second")).toBe(1);
    expect(group!.kinds[0]!.parent.get("second")).toBe("first");
  });

  it("waiting on two, it sits once, under the one drawn last", () => {
    const rowA = row("a", "api", "review", "waiting", 9);
    const rowB = row("b", "api", "review", "waiting", 5);
    const rowC = after(row("c", "api", "review", "waiting", 1), "a", "b");
    const ids = groupTickets([rowA, rowB, rowC])[0]!.kinds[0]!.rows.map((entry) => entry.ticket.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("a chain is a staircase: each one a level under the one it waits on", () => {
    const rowA = row("a", "api", "plan", "waiting", 1);
    const rowB = after(row("b", "api", "plan", "waiting", 2), "a");
    const rowC = after(row("c", "api", "plan", "waiting", 3), "b");
    const kindGroup = groupTickets([rowC, rowB, rowA])[0]!.kinds[0]!;
    expect(kindGroup.rows.map((entry) => entry.ticket.id)).toEqual(["a", "b", "c"]);
    expect(["a", "b", "c"].map((id) => kindGroup.depth.get(id))).toEqual([0, 1, 2]);
  });

  it("two waiting on one are siblings at one depth, each subtree kept whole", () => {
    const rowA = row("a", "api", "plan", "waiting", 1);
    const rowB = after(row("b", "api", "plan", "waiting", 9), "a");
    const rowB2 = after(row("b2", "api", "plan", "waiting", 8), "b");
    const rowC = after(row("c", "api", "plan", "waiting", 5), "a");
    const kindGroup = groupTickets([rowA, rowB, rowB2, rowC])[0]!.kinds[0]!;
    expect(kindGroup.rows.map((entry) => entry.ticket.id)).toEqual(["a", "b", "b2", "c"]);
    expect(["a", "b", "b2", "c"].map((id) => kindGroup.depth.get(id))).toEqual([0, 1, 2, 1]);
  });

  it("a predecessor in another group is no stack here", () => {
    const proposal = row("p", "api", "proposal", "waiting");
    const plan = after(row("l", "api", "plan", "waiting"), "p");
    const [group] = groupTickets([proposal, plan]);
    expect(group!.kinds.find((kindGroup) => kindGroup.kind === "plan")!.depth.get("l")).toBe(0);
  });

  it("a cycle that arrived anyway is drawn plainly, once each", () => {
    const rowA = after(row("a", "api", "plan", "waiting", 1), "b");
    const rowB = after(row("b", "api", "plan", "waiting", 2), "a");
    const kindGroup = groupTickets([rowA, rowB])[0]!.kinds[0]!;
    expect(kindGroup.rows.map((entry) => entry.ticket.id).sort()).toEqual(["a", "b"]);
    expect([kindGroup.depth.get("a"), kindGroup.depth.get("b")]).toEqual([0, 0]);
  });
});
