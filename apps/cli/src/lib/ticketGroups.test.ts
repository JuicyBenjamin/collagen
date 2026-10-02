import { describe, expect, it } from "vitest";
import type { Ticket, TicketKind } from "@collagen/p2p";
import { drawnOrder, groupTickets } from "./ticketGroups";
import type { TicketSummary } from "./ticketSummary";

const row = (id: string, project: string, kind: TicketKind, state: TicketSummary["state"], lastActivity = 1) => ({
  t: { id, project, kind } as Ticket,
  s: { state, lastActivity } as TicketSummary,
});

describe("groupTickets", () => {
  it("groups by project, then by kind in lifecycle order", () => {
    const rows = [row("r", "api", "review", "waiting"), row("t", "api", "task", "waiting"), row("p", "api", "proposal", "waiting"), row("b", "api", "bug", "waiting"), row("l", "api", "plan", "waiting")];
    const [api] = groupTickets(rows);
    expect(api!.kinds.map((k) => k.kind)).toEqual(["proposal", "plan", "bug", "review", "task"]);
  });

  it("inside a group, needs you first, then newest activity", () => {
    const rows = [row("old", "api", "plan", "waiting", 1), row("new", "api", "plan", "waiting", 5), row("you", "api", "plan", "needs-you", 0)];
    expect(drawnOrder(groupTickets(rows)).map((r) => r.t.id)).toEqual(["you", "new", "old"]);
  });

  it("a project holding something for you comes before one that does not", () => {
    const rows = [row("a", "alpha", "plan", "waiting", 9), row("z", "zeta", "review", "needs-you", 1)];
    expect(groupTickets(rows).map((g) => g.project)).toEqual(["zeta", "alpha"]);
  });

  it("projects alike in urgency fall back to newest, then by name", () => {
    const rows = [row("b", "beta", "plan", "waiting", 1), row("a", "alpha", "plan", "waiting", 1)];
    expect(groupTickets(rows).map((g) => g.project)).toEqual(["alpha", "beta"]);
  });
});

describe("stacked tickets inside a group", () => {
  const after = (r: ReturnType<typeof row>, ...ids: string[]) => ({ ...r, t: { ...r.t, after: ids } as Ticket });

  it("a ticket that follows another is drawn right under it, marked as following", () => {
    const first = row("first", "api", "review", "waiting", 1);
    const other = row("other", "api", "review", "waiting", 5);
    const second = after(row("second", "api", "review", "waiting", 9), "first");
    const [g] = groupTickets([first, other, second]);
    expect(g!.kinds[0]!.rows.map((r) => r.t.id)).toEqual(["other", "first", "second"]);
    expect(g!.kinds[0]!.depth.get("second")).toBe(1);
    expect(g!.kinds[0]!.parent.get("second")).toBe("first");
  });

  it("waiting on two, it sits once, under the one drawn last", () => {
    const a = row("a", "api", "review", "waiting", 9);
    const b = row("b", "api", "review", "waiting", 5);
    const c = after(row("c", "api", "review", "waiting", 1), "a", "b");
    const ids = groupTickets([a, b, c])[0]!.kinds[0]!.rows.map((r) => r.t.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("a chain is a staircase: each one a level under the one it waits on", () => {
    const a = row("a", "api", "plan", "waiting", 1);
    const b = after(row("b", "api", "plan", "waiting", 2), "a");
    const c = after(row("c", "api", "plan", "waiting", 3), "b");
    const k = groupTickets([c, b, a])[0]!.kinds[0]!;
    expect(k.rows.map((r) => r.t.id)).toEqual(["a", "b", "c"]);
    expect(["a", "b", "c"].map((id) => k.depth.get(id))).toEqual([0, 1, 2]);
  });

  it("two waiting on one are siblings at one depth, each subtree kept whole", () => {
    const a = row("a", "api", "plan", "waiting", 1);
    const b = after(row("b", "api", "plan", "waiting", 9), "a");
    const b2 = after(row("b2", "api", "plan", "waiting", 8), "b");
    const c = after(row("c", "api", "plan", "waiting", 5), "a");
    const k = groupTickets([a, b, b2, c])[0]!.kinds[0]!;
    expect(k.rows.map((r) => r.t.id)).toEqual(["a", "b", "b2", "c"]);
    expect(["a", "b", "b2", "c"].map((id) => k.depth.get(id))).toEqual([0, 1, 2, 1]);
  });

  it("a predecessor in another group is no stack here", () => {
    const p = row("p", "api", "proposal", "waiting");
    const l = after(row("l", "api", "plan", "waiting"), "p");
    const [g] = groupTickets([p, l]);
    expect(g!.kinds.find((k) => k.kind === "plan")!.depth.get("l")).toBe(0);
  });

  it("a cycle that arrived anyway is drawn plainly, once each", () => {
    const a = after(row("a", "api", "plan", "waiting", 1), "b");
    const b = after(row("b", "api", "plan", "waiting", 2), "a");
    const k = groupTickets([a, b])[0]!.kinds[0]!;
    expect(k.rows.map((r) => r.t.id).sort()).toEqual(["a", "b"]);
    expect([k.depth.get("a"), k.depth.get("b")]).toEqual([0, 0]);
  });
});
