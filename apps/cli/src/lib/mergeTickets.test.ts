import { describe, expect, it } from "vitest";
import type { ReviewComment, ReviewContext, Ticket } from "@collagen/p2p";
import { github, type HostMerge } from "../services/RepoHost";
import { lineage, reviewedCode, ticketsOfMerges, type ReviewedCode } from "./mergeTickets";

const merge = (number: number, branch: string, at: string, kind: HostMerge["kind"] = "squash", commit = `m${number}`): HostMerge => ({
  number,
  url: `https://github.com/acme/shop/pull/${number}`,
  title: `PR ${number}`,
  branch,
  kind,
  commit,
  commits: 2,
  at,
});
const day = (d: number) => Date.parse(`2026-10-${String(d).padStart(2, "0")}T00:00:00Z`);
const tied = (merges: ReadonlyArray<HostMerge>, reviewed: ReadonlyArray<ReviewedCode>) => ticketsOfMerges(merges, reviewed).map((m) => [m.merge.number, m.tickets]);

describe("which tickets each merge came from", () => {
  it("by the pull request a review links to, whatever the merge kind — and only by it", () => {
    const merges = [merge(7, "feat", "2026-10-05T00:00:00Z"), merge(70, "other", "2026-10-06T00:00:00Z", "merge")];
    expect(tied(merges, [{ ticketId: "a", pull: 7 }, { ticketId: "b", pull: 70 }])).toEqual([
      [7, ["a"]],
      [70, ["b"]],
    ]);
    // its pull request was never merged: not another pull request of the same branch name
    expect(tied(merges, [{ ticketId: "c", pull: 9, branch: "feat", filedAt: day(1) }])).toEqual([
      [7, []],
      [70, []],
    ]);
  });

  it("a merge from no ticket is listed with none", () => {
    expect(tied([merge(1, "feat", "2026-10-05T00:00:00Z"), merge(2, "chore", "2026-10-06T00:00:00Z")], [{ ticketId: "a", branch: "feat" }])).toEqual([
      [1, ["a"]],
      [2, []],
    ]);
  });

  it("by branch, the first merge after the ticket was filed: a name used again before it is someone else's work", () => {
    const merges = [merge(3, "fix", "2026-10-09T00:00:00Z"), merge(2, "fix", "2026-10-06T00:00:00Z"), merge(1, "fix", "2026-10-02T00:00:00Z")];
    expect(tied(merges, [{ ticketId: "a", branch: "fix", filedAt: day(4) }])).toEqual([
      [3, []],
      [2, ["a"]],
      [1, []],
    ]);
    // filed after every merge of its branch: not merged yet
    expect(ticketsOfMerges(merges, [{ ticketId: "late", branch: "fix", filedAt: day(10) }]).flatMap((m) => m.tickets)).toEqual([]);
  });

  it("several tickets on one merge, in the order filed; the link decides over the branch", () => {
    const merges = [merge(5, "stack", "2026-10-08T00:00:00Z"), merge(4, "stack-base", "2026-10-07T00:00:00Z")];
    const reviewed = [
      { ticketId: "again", branch: "stack", filedAt: day(6) },
      { ticketId: "first", branch: "stack", filedAt: day(3) },
      { ticketId: "linked", branch: "stack", pull: 4, filedAt: day(1) },
    ];
    expect(tied(merges, reviewed)).toEqual([
      [5, ["first", "again"]],
      [4, ["linked"]],
    ]);
  });

  it("by a commit read at only where the merge kept it — a squash rewrites every commit", () => {
    const merges = [merge(1, "ff", "2026-10-05T00:00:00Z", "fast-forward", "c1"), merge(2, "sq", "2026-10-06T00:00:00Z", "squash", "c2")];
    expect(tied(merges, [{ ticketId: "a", commits: ["c1"] }, { ticketId: "b", commits: ["c2"] }])).toEqual([
      [1, ["a"]],
      [2, []],
    ]);
  });
});

describe("a project's review tickets, as where their code was", () => {
  const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, project: "shop", goal: id, createdBy: "alice", kind: "review", steps: [], structureAt: 1, updatedAt: 1, filedAt: 5, ...over });
  const review = (ticketId: string, branch: string, link?: string): ReviewContext => ({ ticketId, author: "alice", authorName: "Alice", summary: "", branch, ...(link ? { link } : {}), decisions: [], forks: [], ts: 1 });
  const comment = (ticketId: string, commit: string) => ({ ticketId, commit }) as ReviewComment;

  it("what the reader may see, of this project, with the commits its comments were written at", () => {
    const pending = ticket("plan", { kind: "plan", steps: [{ id: "s", owner: "bob", intent: "take", description: "", needs: [], status: "pending", updatedAt: 1 }] });
    const all = new Map(
      [ticket("r"), ticket("gated", { after: ["plan"] }), ticket("elsewhere", { project: "api" }), ticket("task", { kind: "task" }), pending].map((t) => [t.id, t] as const),
    );
    const got = reviewedCode("shop", all, [review("r", "feat", "https://github.com/acme/shop/pull/7/files"), review("gated", "next")], [comment("r", "c1"), comment("r", "c1"), comment("r", "c2")], "bob", github);
    expect(got).toEqual([{ ticketId: "r", filedAt: 5, pull: 7, branch: "feat", commits: ["c1", "c2"] }]);
    // its author sees their own while it waits
    expect(reviewedCode("shop", all, [], [], "alice", github).map((c) => c.ticketId)).toEqual(["r", "gated"]);
    // a project is one project however this machine cases its name
    expect(reviewedCode("Shop", all, [], [], "bob", github).map((c) => c.ticketId)).toEqual(["r"]);
  });
});

describe("what a merge grew from", () => {
  const ticket = (id: string, kind: Ticket["kind"], from: ReadonlyArray<string> = [], over: Partial<Ticket> = {}): Ticket => ({ id, project: "shop", goal: id, createdBy: "alice", kind, steps: [], structureAt: 1, updatedAt: 1, from, ...over });

  it("the whole chain, each once, what it grew from first: proposal, plan, task, review", () => {
    const all = new Map(
      [
        ticket("idea", "proposal"),
        ticket("plan", "plan", ["idea"]),
        ticket("do", "task", ["plan"]),
        ticket("other-task", "task", ["plan"]),
        ticket("r1", "review", ["do"]),
        ticket("r2", "review", ["other-task", "idea"]),
      ].map((t) => [t.id, t] as const),
    );
    expect(lineage(["r1"], all, "bob").map((t) => t.id)).toEqual(["idea", "plan", "do", "r1"]);
    // a stack reviewed in parts: the shared roots once, before both
    expect(lineage(["r1", "r2"], all, "bob").map((t) => t.id)).toEqual(["idea", "plan", "do", "r1", "other-task", "r2"]);
  });

  it("a ticket the reader may not see is left out, and the chain past it kept", () => {
    const all = new Map(
      [ticket("idea", "proposal"), ticket("gate", "plan", [], { steps: [{ id: "s", owner: "bob", intent: "take", description: "", needs: [], status: "pending", updatedAt: 1 }] }), ticket("plan", "plan", ["idea"], { after: ["gate"] }), ticket("r", "review", ["plan"])].map(
        (t) => [t.id, t] as const,
      ),
    );
    expect(lineage(["r"], all, "carol").map((t) => t.id)).toEqual(["idea", "r"]);
  });
});
