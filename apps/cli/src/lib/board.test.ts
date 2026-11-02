import { describe, expect, it } from "vitest";
import type { StepStatus, Ticket } from "@collagen/p2p";
import { boardOf } from "./board";

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
const ids = (lanes: ReturnType<typeof boardOf>) => Object.fromEntries(lanes.map((lane) => [lane.column, lane.rows.map((row) => row.ticket.id)]));

describe("boardOf", () => {
  it("puts every ticket the reader may see in one column", () => {
    const lanes = boardOf([ticket("a", "bob", "pending"), ticket("b", "bob", "suspended"), ticket("c", "bob", "settled")], [], "carol");
    expect(ids(lanes)).toEqual({ todo: ["a"], doing: ["b"], done: ["c"] });
  });

  it("a ticket waiting on another is its author's alone, on the board too", () => {
    const first = ticket("first", "bob", "pending");
    const second = ticket("second", "bob", "pending", { after: ["first"], updatedAt: 2 });
    expect(ids(boardOf([first, second], [], "carol")).todo).toEqual(["first"]);
    expect(ids(boardOf([first, second], [], "alice")).todo).toEqual(["second", "first"]);
  });

  it("in a column, what wants the reader comes first", () => {
    const theirs = ticket("theirs", "bob", "suspended", { updatedAt: 9 });
    const yours = ticket("yours", "carol", "suspended", { updatedAt: 1 });
    expect(ids(boardOf([theirs, yours], [], "carol")).doing).toEqual(["yours", "theirs"]);
  });
});
