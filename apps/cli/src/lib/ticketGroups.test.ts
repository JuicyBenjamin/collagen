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
