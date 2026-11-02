import { describe, expect, it } from "vitest";
import type { StepStatus, Ticket } from "@collagen/p2p";
import { boardEpics, boardOf } from "./board";

const ticket = (id: string, owner: string, status: StepStatus, over: Partial<Ticket> = {}): Ticket => ({
  id,
  project: "collagen",
  goal: id,
  createdBy: "alice",
  kind: "task",
  steps: [{ id: `${id}-s`, owner, intent: "do", description: "d", needs: [], status, updatedAt: 1 }],
  structureAt: 1,
  updatedAt: 1,
  ...over,
});
const DAY = 86_400_000;
const NOW = { now: 10 * DAY };
const ids = (lanes: ReturnType<typeof boardOf>) => Object.fromEntries(lanes.map((lane) => [lane.column, lane.rows.map((row) => row.ticket.id)]));

describe("boardOf", () => {
  it("puts every ticket the reader may see in one column", () => {
    const lanes = boardOf([ticket("a", "bob", "pending"), ticket("b", "bob", "suspended"), ticket("c", "bob", "settled")], [], "carol", NOW);
    expect(ids(lanes)).toEqual({ todo: ["a"], doing: ["b"], done: ["c"] });
  });

  it("a ticket waiting on another is its author's alone, on the board too", () => {
    const first = ticket("first", "bob", "pending");
    const second = ticket("second", "bob", "pending", { after: ["first"], updatedAt: 2 });
    expect(ids(boardOf([first, second], [], "carol", NOW)).todo).toEqual(["first"]);
    expect(ids(boardOf([first, second], [], "alice", NOW)).todo).toEqual(["second", "first"]);
  });

  it("in a column, what wants the reader comes first", () => {
    const theirs = ticket("theirs", "bob", "suspended", { updatedAt: 9 });
    const yours = ticket("yours", "carol", "suspended", { updatedAt: 1 });
    expect(ids(boardOf([theirs, yours], [], "carol", NOW)).doing).toEqual(["yours", "theirs"]);
  });

  it("has no epic of its own: an epic is a view of the board, offered while it has open tickets", () => {
    const epic: Ticket = { ...ticket("epic", "bob", "pending"), kind: "epic", steps: [] };
    const inside = ticket("inside", "bob", "pending", { partOf: [{ id: "m1", epic: "epic", by: "alice", at: 1 }] });
    const outside = ticket("outside", "bob", "pending");
    expect([...ids(boardOf([epic, inside, outside], [], "carol", NOW)).todo!].sort()).toEqual(["inside", "outside"]);
    expect(ids(boardOf([epic, inside, outside], [], "carol", { ...NOW, epic: "epic" })).todo).toEqual(["inside"]);
    expect(boardEpics([epic, inside, outside], "carol").map((entry) => [entry.epic.id, entry.open])).toEqual([["epic", 1]]);
  });

  it("stacks what grew from what, the latest on top", () => {
    const proposal = ticket("proposal", "bob", "pending", { kind: "proposal", updatedAt: 1 });
    const plan = ticket("plan", "bob", "pending", { kind: "plan", from: ["proposal"], updatedAt: 2 });
    const other = ticket("other", "bob", "pending", { updatedAt: 3 });
    const todo = boardOf([proposal, plan, other], [], "carol", NOW).find((lane) => lane.column === "todo")!;
    expect(todo.stacks.map((stack) => stack.map((row) => row.ticket.id))).toEqual([["other"], ["plan", "proposal"]]);
  });

  it("a kind filter keeps a line of work's cards of those kinds, still stacked as one line", () => {
    const proposal = ticket("proposal", "bob", "pending", { kind: "proposal", updatedAt: 1 });
    const plan = ticket("plan", "bob", "pending", { kind: "plan", from: ["proposal"], updatedAt: 2 });
    const task = ticket("task", "bob", "pending", { kind: "task", from: ["plan"], updatedAt: 3 });
    const bug = ticket("bug", "bob", "pending", { kind: "bug", updatedAt: 4 });
    const todo = boardOf([proposal, plan, task, bug], [], "carol", { ...NOW, kinds: ["proposal", "task"] }).find((lane) => lane.column === "todo")!;
    expect(todo.stacks.map((stack) => stack.map((row) => row.ticket.id))).toEqual([["task", "proposal"]]);
  });

  it("keeps done to what finished lately, the rest counted", () => {
    const lately = ticket("lately", "bob", "settled", { updatedAt: 25 * DAY });
    const long = ticket("long", "bob", "settled", { updatedAt: 1 * DAY });
    const done = boardOf([lately, long], [], "carol", { now: 30 * DAY }).find((lane) => lane.column === "done")!;
    expect([done.rows.map((row) => row.ticket.id), done.older]).toEqual([["lately"], 1]);
    expect(boardOf([lately, long], [], "carol", { now: 30 * DAY, allDone: true }).find((lane) => lane.column === "done")!.older).toBe(0);
  });
});
