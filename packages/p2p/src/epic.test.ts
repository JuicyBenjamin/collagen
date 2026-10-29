import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Ticket as TicketSchema, closeTicket, ticketName, epicBecause, epicClosed, epicForFiling, epicOf, epicParts, epicStatus, excludedFromEpic, finished, heldBy, isClosed, isJudged, mergeTicket, moveToEpic, orderEpic, PARTS_DONE, turnEpic, type Ticket } from "./ticket";

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
const step = (status: "pending" | "settled") => [{ id: "s", owner: "alice", intent: "do", description: "d", needs: [], status, updatedAt: 1 }] as const;
const done = (id: string, project = "collagen"): Ticket => ticket({ id, project, steps: [...step("settled")] });
const open = (id: string, project = "collagen"): Ticket => ticket({ id, project, steps: [...step("pending")] });
const room = (...tickets: ReadonlyArray<Ticket>) => new Map(tickets.map((roomTicket) => [roomTicket.id, roomTicket]));
const into = (child: Ticket, at: number, by = "bob") => moveToEpic(child, "e1", by, at);

describe("an epic is a folder, not a judged ticket", () => {
  it("asks nothing of its own and is never 'finished' by steps", () => {
    expect(isJudged("epic")).toBe(false);
    expect(finished(epic)).toBe(false);
    expect(closeTicket(epic, "alice", "done", 2).outcome).toBe("epic");
  });
});

describe("membership is explicit", () => {
  it("anyone moves any ticket, and the latest move is where it is", () => {
    const inE1 = into(open("php"), 10);
    expect(epicOf(inE1)).toBe("e1");
    const elsewhere = moveToEpic(inE1, "e2", "carol", 20);
    expect(epicOf(elsewhere)).toBe("e2");
    expect(epicOf(moveToEpic(elsewhere, null, "alice", 30))).toBeNull();
  });

  it("lineage puts nothing anywhere: a plan from a part is in no epic until it is put there", () => {
    const plan = ticket({ id: "plan", from: ["php"] });
    const all = room(epic, into(open("php"), 1), plan);
    expect(epicOf(plan)).toBeNull();
    expect(epicParts(epic, all).parts.map((part) => part.id)).toEqual(["php"]);
  });

  it("two people moving the same ticket at once end in the same place on every peer", () => {
    const base = open("php");
    const bobs = moveToEpic(base, "e1", "bob", 10);
    const carols = moveToEpic(base, "e2", "carol", 11);
    const merged = mergeTicket(bobs, carols);
    expect(epicOf(merged)).toBe("e2");
    expect(merged.partOf).toEqual(mergeTicket(carols, bobs).partOf);
    expect(mergeTicket(merged, base).partOf).toEqual(merged.partOf);
  });
});

describe("progress is a ticket count", () => {
  it("done against all; a close says how it ended; excluded or dropped work leaves the count, 4 of 5 → 4 of 4", () => {
    const four = ["a", "b", "c", "d"].map((id, index) => into(done(id), index));
    const fifth = into(open("e"), 9);
    expect(epicParts(epic, room(epic, ...four, fifth))).toMatchObject({ counted: 5, done: 4 });
    // closed as done with its own step never settled: done
    const closedDone = closeTicket(fifth, "alice", "merged", 10, "done").ticket;
    expect(finished(closedDone)).toBe(false);
    expect(epicParts(epic, room(epic, ...four, closedDone))).toMatchObject({ counted: 5, done: 5 });
    // closed as dropped: out of the count, as excluded work is
    const dropped = closeTicket(fifth, "alice", "superseded", 10, "dropped").ticket;
    expect(epicParts(epic, room(epic, ...four, dropped))).toMatchObject({ counted: 4, done: 4 });
    // a close from before the outcome was asked: done, since dropped work was taken out or excluded then
    const legacy = { ...fifth, closed: { by: "alice", ts: 10 } };
    expect(epicParts(epic, room(epic, ...four, legacy))).toMatchObject({ counted: 5, done: 5 });
    const excluded = moveToEpic(fifth, "e1", "bob", 11, true);
    expect(excludedFromEpic(excluded)).toBe(true);
    expect(epicParts(epic, room(epic, ...four, excluded))).toMatchObject({ counted: 4, done: 4 });
  });

  it("the reading order is anyone's to set, and only orders: it gates nothing", () => {
    const php = into(open("php"), 1);
    const rust = into(open("rust"), 2);
    const ordered = orderEpic(epic, ["rust", "php"], "carol", 5);
    expect(epicParts(ordered, room(ordered, php, rust)).parts.map((part) => part.id)).toEqual(["rust", "php"]);
    expect(rust.after).toBeUndefined();
  });
});

describe("closing and reopening an epic", () => {
  it("closes only once everything in it is resolved — done, closed or excluded — with that as the reason", () => {
    const left = room(epic, into(done("php"), 1), into(open("rust"), 2));
    const refused = turnEpic(epic, true, undefined, "bob", left, 5);
    expect(refused.outcome).toBe("unresolved");
    expect(refused.unresolved.map((unresolved) => unresolved.id)).toEqual(["rust"]);
    const all = room(epic, into(done("php"), 1), moveToEpic(open("rust"), "e1", "bob", 3, true));
    const closed = turnEpic(epic, true, undefined, "bob", all, 5);
    expect(closed.outcome).toBe("turned");
    expect(epicClosed(closed.ticket, room(closed.ticket, ...[...all.values()].filter((roomTicket) => roomTicket.id !== "e1")))).toBe(true);
    expect(closed.ticket.turns?.at(-1)).toMatchObject({ closed: true, reason: PARTS_DONE, by: "bob" });
  });

  it("reopening needs a reason, and anyone may", () => {
    const php = into(done("php"), 1);
    const closed = turnEpic(epic, true, undefined, "bob", room(epic, php), 5).ticket;
    expect(turnEpic(closed, false, " ", "carol", room(closed, php), 6).outcome).toBe("needs-reason");
    const reopened = turnEpic(closed, false, "Go next", "carol", room(closed, php), 6).ticket;
    expect(epicClosed(reopened, room(reopened, php))).toBe(false);
  });

  it("other tickets keep their own close: the author's, and it sticks", () => {
    expect(turnEpic(open("php"), true, "x", "bob", room(), 1).outcome).toBe("not-an-epic");
    expect(isClosed(closeTicket(open("php"), "alice", undefined, 1).ticket)).toBe(true);
  });
});

describe("turns made at once, offline from each other", () => {
  const php = into(done("php"), 1);

  it("close against an add it had not seen: open everywhere, until a close that saw it", () => {
    // alice closes with php in it; bob, offline, puts rust in
    const alices = turnEpic(epic, true, undefined, "alice", room(epic, php), 10).ticket;
    const rust = into(open("rust"), 11, "bob");
    const synced = room(alices, php, rust);
    expect(epicClosed(alices, synced)).toBe(false);
    // rust is moved out after syncing, but alice's close never saw it go in: still open
    const out = moveToEpic(rust, null, "carol", 20);
    expect(epicClosed(alices, room(alices, php, out))).toBe(false);
    // a close made after seeing all of it stands
    const again = turnEpic(alices, true, "rust moved out", "carol", room(alices, php, out), 21).ticket;
    expect(epicClosed(again, room(again, php, out))).toBe(true);
  });

  it("close against a reopen it had not seen: open, with both kept; a later close stands for good", () => {
    const firstClose = turnEpic(epic, true, undefined, "alice", room(epic, php), 10).ticket;
    // bob reopens what he saw closed; carol, who also saw the first close and not bob's reopen, … cannot close a closed
    // epic — so the race is a close written on a copy that had not seen an earlier reopen:
    const reopen = turnEpic(firstClose, false, "Go next", "bob", room(firstClose, php), 20).ticket;
    const beforeReopen = { ...firstClose, turns: [...(firstClose.turns ?? []), { id: "carol:30:close", closed: true, reason: "done", by: "carol", at: 30, knows: [firstClose.turns![0]!.id], members: [php.partOf![0]!.id] }] };
    const merged = mergeTicket(reopen, beforeReopen);
    expect(merged.turns).toHaveLength(3);
    expect(epicClosed(merged, room(merged, php))).toBe(false);
    expect(epicClosed(mergeTicket(beforeReopen, reopen), room(php))).toBe(false);
    // a close that has seen both stands — the old reopen does not reopen it again
    const finalClose = turnEpic(merged, true, "Go done too", "alice", room(merged, php), 40).ticket;
    expect(epicClosed(finalClose, room(finalClose, php))).toBe(true);
    expect(epicClosed(mergeTicket(finalClose, reopen), room(php))).toBe(true);
  });
});

describe("from the review of the epics branch", () => {
  it("a close against an addition gated by after: the reader who may not see it is not told its name", () => {
    const php = into(done("php"), 1);
    const closed = turnEpic(epic, true, undefined, "alice", room(epic, php), 10).ticket;
    const gate = ticket({ id: "gate", steps: [...step("pending")] });
    const secret = { ...into(ticket({ id: "secret", goal: "Secret gated work", after: ["gate"], steps: [...step("pending")] }), 11, "alice") };
    const all = room(closed, php, gate, secret);
    const state = epicStatus(closed, all);
    expect(state).toMatchObject({ closed: false, cause: { kind: "unseen-add", ticket: "secret" } });
    expect(epicBecause(state, all, "alice")).toMatch(/"Secret gated work" was put in/);
    expect(epicBecause(state, all, "bob")).toMatch(/^a ticket you are not shown yet was put in/);
    expect(epicBecause(state, all, "bob")).not.toMatch(/Secret/);
  });

  it("every move has its own id: two by one person in one millisecond merge the same in either order", () => {
    const base = open("php");
    const movedToFirst = moveToEpic(base, "e1", "bob", 10);
    const movedToSecond = moveToEpic(base, "e2", "bob", 10);
    expect(movedToFirst.partOf![0]!.id).not.toBe(movedToSecond.partOf![0]!.id);
    expect(epicOf(mergeTicket(movedToFirst, movedToSecond))).toBe(epicOf(mergeTicket(movedToSecond, movedToFirst)));
    expect(mergeTicket(movedToFirst, movedToSecond).partOf).toHaveLength(2);
    // and across tickets: a close that saw one of two same-millisecond moves did not see the other
    const firstMove = into(done("x"), 20);
    const secondMove = into(done("y"), 20);
    expect(firstMove.partOf![0]!.id).not.toBe(secondMove.partOf![0]!.id);
    const sawX = turnEpic(epic, true, undefined, "alice", room(epic, firstMove), 21).ticket;
    expect(epicClosed(sawX, room(sawX, firstMove, secondMove))).toBe(false);
  });

  it("an after gate on an epic uses the same rule: an unseen open ticket keeps it holding", () => {
    const php = into(done("php"), 1);
    const closed = turnEpic(epic, true, undefined, "alice", room(epic, php), 10).ticket;
    const rust = into(open("rust"), 11);
    const next = ticket({ id: "next", after: ["e1"] });
    expect(heldBy(next, room(closed, php, next), "carol")).toEqual([]);
    expect(heldBy(next, room(closed, php, rust, next), "carol")).toEqual(["e1"]);
  });

  it("the reason shown is the one behind the state — a slow clock's reopen, a close that missed an addition", () => {
    const php = into(done("php"), 1);
    const closed = turnEpic(epic, true, "shipped", "alice", room(epic, php), 100).ticket;
    // bob's clock runs behind: his reopen, made after seeing the close, is stamped earlier
    const reopened = turnEpic(closed, false, "Go next", "bob", room(closed, php), 50).ticket;
    expect(epicStatus(reopened, room(reopened, php))).toMatchObject({ closed: false, cause: { kind: "reopen", reason: "Go next", by: "bob" } });
    // a close that missed an addition: open, because of that ticket — and a reopen can still be recorded
    const rust = { ...into(open("rust"), 101), goal: "Rust on the review page" };
    const state = epicStatus(closed, room(closed, php, rust));
    expect(state.closed).toBe(false);
    expect(epicBecause(state, room(closed, php, rust), "alice")).toMatch(/"Rust on the review page" was put in without the close seeing it/);
    const said = turnEpic(closed, false, "Rust belongs here", "carol", room(closed, php, rust), 102);
    expect(said.outcome).toBe("turned");
    expect(epicBecause(epicStatus(said.ticket, room(said.ticket, php, rust)), room(said.ticket, php, rust), "carol")).toBe("Rust belongs here");
  });
});

describe("a ticket's title", () => {
  it("is the author's structure: the newer revision wins, either way round, and a peer's stale copy cannot drop it", () => {
    const streamed = ticket({ id: "t1", title: "Streamed export", goal: "stream the export, do not buffer it", structureAt: 1 });
    const paged = { ...streamed, title: "Paged export", structureAt: 2 };
    expect(mergeTicket(streamed, paged).title).toBe("Paged export");
    expect(mergeTicket(paged, streamed).title).toBe("Paged export");
    const stale = { ...paged, title: undefined, updatedAt: 9 };
    expect(mergeTicket(paged, { ...stale, structureAt: 2 }).title).toBe("Paged export");
    expect(ticketName(paged)).toBe("Paged export");
    expect(ticketName({ goal: "an old one" })).toBe("an old one");
  });

  it("merges the same however copies are grouped, on a tie of the author's clock too", () => {
    const copyA = ticket({ id: "t1", goal: "a", title: "A", structureAt: 1 });
    const copyB = ticket({ id: "t1", goal: "b", structureAt: 1 });
    const copyC = ticket({ id: "t1", goal: "a", title: "B", structureAt: 1 });
    const copyD = ticket({ id: "t1", goal: "c", title: "C", structureAt: 2 });
    const head = (copy: ReturnType<typeof ticket>) => [copy.goal, copy.title ?? null];
    for (const set of [[copyA, copyB, copyC], [copyA, copyB, copyD], [copyB, copyC, copyD]]) {
      const [left, middle, right] = set as [typeof copyA, typeof copyA, typeof copyA];
      const want = head(mergeTicket(mergeTicket(left, middle), right));
      for (const [first, second, third] of [[left, middle, right], [left, right, middle], [middle, left, right], [middle, right, left], [right, left, middle], [right, middle, left]] as const) {
        expect(head(mergeTicket(mergeTicket(first, second), third))).toEqual(want);
        expect(head(mergeTicket(first, mergeTicket(second, third)))).toEqual(want);
      }
    }
    // a titled revision is never lost to an untitled one of the same clock
    expect(mergeTicket(copyB, copyA).title).toBe("A");
  });
});

describe("a close's outcome on the log", () => {
  it("a ticket closed before outcomes were asked still decodes, and one with an outcome keeps it", () => {
    const decode = Schema.decodeUnknownSync(TicketSchema);
    const base = { id: "t", project: "collagen", goal: "g", createdBy: "alice", kind: "task", steps: [], structureAt: 1, updatedAt: 1 };
    expect(decode({ ...base, closed: { by: "alice", ts: 2 } }).closed).toEqual({ by: "alice", ts: 2 });
    expect(decode({ ...base, closed: { by: "alice", ts: 2, outcome: "dropped" } }).closed?.outcome).toBe("dropped");
  });
});

describe("progress counts lines of work, not tickets", () => {
  it("a proposal, its plan and its review are one line: done when all of it is", () => {
    const proposal = into(done("idea"), 1);
    const plan = into(done("plan-it"), 2);
    const review = into(open("review-it"), 3);
    const lineOf = { ...plan, from: ["idea"] };
    const reviewed = { ...review, from: ["plan-it"] };
    const other = into(done("other"), 4);
    const all = room(epic, proposal, lineOf, reviewed, other);
    expect(epicParts(epic, all)).toMatchObject({ counted: 2, done: 1 });
    expect(epicParts(epic, all).lines.map((line) => line.map((part) => part.id))).toEqual([["idea", "plan-it", "review-it"], ["other"]]);
    // the review done: the whole line is
    expect(epicParts(epic, room(epic, proposal, lineOf, { ...reviewed, steps: [...step("settled")] }, other))).toMatchObject({ counted: 2, done: 2 });
  });

  it("a stage grown through a ticket outside the epic still joins its line", () => {
    const proposal = into(done("idea"), 1);
    const plan = { ...open("plan-it"), from: ["idea"] };
    const review = { ...into(open("review-it"), 2), from: ["plan-it"] };
    expect(epicParts(epic, room(epic, proposal, plan, review)).counted).toBe(1);
  });

  it("a line all dropped is not counted", () => {
    const dropped = closeTicket(into(open("gone"), 1), "alice", undefined, 5, "dropped").ticket;
    expect(epicParts(epic, room(epic, dropped, into(done("kept"), 2)))).toMatchObject({ counted: 1, done: 1 });
  });
});

describe("a ticket filed out of a part of an epic goes into it", () => {
  const part = into(open("part"), 1);
  it("the one open epic its parents are in, unless its filer named one or none", () => {
    expect(epicForFiling(["part"], room(epic, part))).toBe("e1");
    expect(epicForFiling(["part"], room(epic, part), null)).toBeNull();
    expect(epicForFiling(["part"], room(epic, part), "e2")).toBe("e2");
  });
  it("none when its parents are in no epic, in two, or their epic is closed", () => {
    const otherEpic = ticket({ id: "e2", kind: "epic", project: "", goal: "other" });
    const elsewhere = moveToEpic(open("elsewhere"), "e2", "bob", 1);
    expect(epicForFiling(["loose"], room(epic, open("loose")))).toBeNull();
    expect(epicForFiling(["part", "elsewhere"], room(epic, otherEpic, part, elsewhere))).toBeNull();
    const finishedPart = closeTicket(part, "alice", undefined, 8, "done").ticket;
    const closed = turnEpic(epic, true, "done", "alice", room(epic, finishedPart), 9).ticket;
    expect(epicForFiling(["part"], room(closed, finishedPart))).toBeNull();
  });
});
