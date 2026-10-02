import { describe, expect, it } from "vitest";
import { closeTicket, epicHome, epicOf, epicParts, finished, isClosed, isJudged, mergeTicket, moveToEpic, PARTS_DONE, turnEpic, type Ticket } from "./ticket";

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t",
  project: "collagen",
  goal: "g",
  createdBy: "alice",
  kind: "task",
  steps: [],
  structureAt: 1,
  updatedAt: 1,
  ...over,
});
const epic = ticket({ id: "e1", kind: "epic", project: "", goal: "more languages" });
const done = (id: string, project = "collagen"): Ticket =>
  ticket({ id, project, steps: [{ id: "s", owner: "alice", intent: "do", description: "d", needs: [], status: "settled", updatedAt: 1 }] });
const open = (id: string, project = "collagen"): Ticket =>
  ticket({ id, project, steps: [{ id: "s", owner: "alice", intent: "do", description: "d", needs: [], status: "pending", updatedAt: 1 }] });
const room = (...ts: ReadonlyArray<Ticket>) => new Map(ts.map((t) => [t.id, t]));

describe("an epic is a folder, not a judged ticket", () => {
  it("asks nothing of its own and is never 'finished' by steps", () => {
    expect(isJudged("epic")).toBe(false);
    expect(finished(epic)).toBe(false);
    expect(closeTicket(epic, "alice", "done", 2).outcome).toBe("epic");
  });
});

describe("moving tickets in and out of epics", () => {
  it("anyone moves any ticket, and the latest move is where it is", () => {
    const php = open("php");
    const inE1 = moveToEpic(php, "e1", "bob", 10);
    expect(epicOf(inE1)).toBe("e1");
    const elsewhere = moveToEpic(inE1, "e2", "carol", 20);
    expect(epicOf(elsewhere)).toBe("e2");
    expect(epicOf(moveToEpic(elsewhere, null, "alice", 30))).toBeNull();
  });

  it("two people moving the same ticket at once end in the same place on every peer", () => {
    const base = open("php");
    const bobs = moveToEpic(base, "e1", "bob", 10);
    const carols = moveToEpic(base, "e2", "carol", 11);
    const a = mergeTicket(bobs, carols);
    const b = mergeTicket(carols, bobs);
    expect(epicOf(a)).toBe("e2");
    expect(a.partOf).toEqual(b.partOf);
    // a peer on a copy without moves loses none of them
    expect(mergeTicket(a, base).partOf).toEqual(a.partOf);
  });

  it("an epic's parts span projects, and count as done when closed or every step answered", () => {
    const parts = [moveToEpic(done("php"), "e1", "bob", 1), moveToEpic(open("rust", "other"), "e1", "bob", 2), moveToEpic(open("x"), "e2", "bob", 3)];
    const { parts: inside, done: n } = epicParts(epic, room(epic, ...parts));
    expect(inside.map((t) => t.id).sort()).toEqual(["php", "rust"]);
    expect(n).toBe(1);
  });
});

describe("where a ticket lives", () => {
  it("a ticket never moved lives where the ticket it grew out of lives; a move, out included, holds", () => {
    const proposal = moveToEpic(open("php"), "e1", "bob", 1);
    const plan = ticket({ id: "plan", from: ["php"] });
    const review = ticket({ id: "review", from: ["plan"] });
    const all = room(epic, proposal, plan, review);
    expect(epicHome(review, all)).toBe("e1");
    const movedOut = moveToEpic(review, null, "carol", 2);
    expect(epicHome(movedOut, room(epic, proposal, plan, movedOut))).toBeNull();
    expect(epicHome(epic, all)).toBeNull();
  });
});

describe("closing and reopening an epic", () => {
  it("closing with parts left needs a reason; with every part done it is that they are", () => {
    const left = room(epic, moveToEpic(done("php"), "e1", "bob", 1), moveToEpic(open("rust"), "e1", "bob", 2));
    expect(turnEpic(epic, true, undefined, "bob", left, 5).outcome).toBe("needs-reason");
    const allDone = room(epic, moveToEpic(done("php"), "e1", "bob", 1));
    const closed = turnEpic(epic, true, undefined, "bob", allDone, 5);
    expect(closed.outcome).toBe("turned");
    expect(isClosed(closed.ticket)).toBe(true);
    expect(closed.ticket.turns?.at(-1)).toMatchObject({ closed: true, reason: PARTS_DONE, by: "bob" });
  });

  it("anyone reopens it, always with a reason, and the latest turn holds across merges", () => {
    const closed = turnEpic(epic, true, "superseded", "bob", room(epic), 5).ticket;
    expect(turnEpic(closed, false, " ", "carol", room(closed), 6).outcome).toBe("needs-reason");
    const reopened = turnEpic(closed, false, "more work in the same area", "carol", room(closed), 6).ticket;
    expect(isClosed(reopened)).toBe(false);
    // the copy that only saw the close does not win back: turns are a set
    expect(isClosed(mergeTicket(closed, reopened))).toBe(false);
    expect(isClosed(mergeTicket(reopened, closed))).toBe(false);
    expect(turnEpic(reopened, false, "again", "carol", room(reopened), 7).outcome).toBe("already");
  });

  it("other tickets keep their own close: the author's, and it sticks", () => {
    expect(turnEpic(open("php"), true, "x", "bob", room(), 1).outcome).toBe("not-an-epic");
    expect(isClosed(closeTicket(open("php"), "alice", undefined, 1).ticket)).toBe(true);
  });
});
