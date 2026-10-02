import { describe, expect, it } from "vitest";
import { closeTicket, ticketName, epicBecause, epicClosed, epicOf, epicParts, epicStatus, excludedFromEpic, finished, heldBy, isClosed, isJudged, mergeTicket, moveToEpic, orderEpic, PARTS_DONE, turnEpic, type Ticket } from "./ticket";

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
const room = (...ts: ReadonlyArray<Ticket>) => new Map(ts.map((t) => [t.id, t]));
const into = (t: Ticket, at: number, by = "bob") => moveToEpic(t, "e1", by, at);

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
    expect(epicParts(epic, all).parts.map((t) => t.id)).toEqual(["php"]);
  });

  it("two people moving the same ticket at once end in the same place on every peer", () => {
    const base = open("php");
    const bobs = moveToEpic(base, "e1", "bob", 10);
    const carols = moveToEpic(base, "e2", "carol", 11);
    const a = mergeTicket(bobs, carols);
    expect(epicOf(a)).toBe("e2");
    expect(a.partOf).toEqual(mergeTicket(carols, bobs).partOf);
    expect(mergeTicket(a, base).partOf).toEqual(a.partOf);
  });
});

describe("progress is a ticket count", () => {
  it("done against all; closing does not make a ticket done; dropped work is excluded, 4 of 5 → 4 of 4", () => {
    const four = ["a", "b", "c", "d"].map((id, i) => into(done(id), i));
    const fifth = into(open("e"), 9);
    expect(epicParts(epic, room(epic, ...four, fifth))).toMatchObject({ counted: 5, done: 4 });
    const closedUnfinished = { ...fifth, closed: { by: "alice", ts: 10 } };
    expect(epicParts(epic, room(epic, ...four, closedUnfinished))).toMatchObject({ counted: 5, done: 4 });
    const excluded = moveToEpic(fifth, "e1", "bob", 11, true);
    expect(excludedFromEpic(excluded)).toBe(true);
    expect(epicParts(epic, room(epic, ...four, excluded))).toMatchObject({ counted: 4, done: 4 });
  });

  it("the reading order is anyone's to set, and only orders: it gates nothing", () => {
    const php = into(open("php"), 1);
    const rust = into(open("rust"), 2);
    const ordered = orderEpic(epic, ["rust", "php"], "carol", 5);
    expect(epicParts(ordered, room(ordered, php, rust)).parts.map((t) => t.id)).toEqual(["rust", "php"]);
    expect(rust.after).toBeUndefined();
  });
});

describe("closing and reopening an epic", () => {
  it("closes only once everything in it is resolved — done, closed or excluded — with that as the reason", () => {
    const left = room(epic, into(done("php"), 1), into(open("rust"), 2));
    const refused = turnEpic(epic, true, undefined, "bob", left, 5);
    expect(refused.outcome).toBe("unresolved");
    expect(refused.unresolved.map((t) => t.id)).toEqual(["rust"]);
    const all = room(epic, into(done("php"), 1), moveToEpic(open("rust"), "e1", "bob", 3, true));
    const closed = turnEpic(epic, true, undefined, "bob", all, 5);
    expect(closed.outcome).toBe("turned");
    expect(epicClosed(closed.ticket, room(closed.ticket, ...[...all.values()].filter((t) => t.id !== "e1")))).toBe(true);
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
    const c1 = turnEpic(epic, true, undefined, "alice", room(epic, php), 10).ticket;
    // bob reopens what he saw closed; carol, who also saw c1 and not bob's reopen, … cannot close a closed
    // epic — so the race is a close written on a copy that had not seen an earlier reopen:
    const r1 = turnEpic(c1, false, "Go next", "bob", room(c1, php), 20).ticket;
    const beforeR1 = { ...c1, turns: [...(c1.turns ?? []), { id: "carol:30:close", closed: true, reason: "done", by: "carol", at: 30, knows: [c1.turns![0]!.id], members: [php.partOf![0]!.id] }] };
    const merged = mergeTicket(r1, beforeR1);
    expect(merged.turns).toHaveLength(3);
    expect(epicClosed(merged, room(merged, php))).toBe(false);
    expect(epicClosed(mergeTicket(beforeR1, r1), room(php))).toBe(false);
    // a close that has seen both stands — the old reopen does not reopen it again
    const c3 = turnEpic(merged, true, "Go done too", "alice", room(merged, php), 40).ticket;
    expect(epicClosed(c3, room(c3, php))).toBe(true);
    expect(epicClosed(mergeTicket(c3, r1), room(php))).toBe(true);
  });
});

describe("from the review of the epics branch", () => {
  it("a close against an addition gated by after: the reader who may not see it is not told its name", () => {
    const php = into(done("php"), 1);
    const closed = turnEpic(epic, true, undefined, "alice", room(epic, php), 10).ticket;
    const gate = ticket({ id: "gate", steps: [...step("pending")] });
    const secret = { ...into(ticket({ id: "secret", goal: "Secret gated work", after: ["gate"], steps: [...step("pending")] }), 11, "alice") };
    const all = room(closed, php, gate, secret);
    const st = epicStatus(closed, all);
    expect(st).toMatchObject({ closed: false, cause: { kind: "unseen-add", ticket: "secret" } });
    expect(epicBecause(st, all, "alice")).toMatch(/"Secret gated work" was put in/);
    expect(epicBecause(st, all, "bob")).toMatch(/^a ticket you are not shown yet was put in/);
    expect(epicBecause(st, all, "bob")).not.toMatch(/Secret/);
  });

  it("every move has its own id: two by one person in one millisecond merge the same in either order", () => {
    const base = open("php");
    const a = moveToEpic(base, "e1", "bob", 10);
    const b = moveToEpic(base, "e2", "bob", 10);
    expect(a.partOf![0]!.id).not.toBe(b.partOf![0]!.id);
    expect(epicOf(mergeTicket(a, b))).toBe(epicOf(mergeTicket(b, a)));
    expect(mergeTicket(a, b).partOf).toHaveLength(2);
    // and across tickets: a close that saw one of two same-millisecond moves did not see the other
    const x = into(done("x"), 20);
    const y = into(done("y"), 20);
    expect(x.partOf![0]!.id).not.toBe(y.partOf![0]!.id);
    const sawX = turnEpic(epic, true, undefined, "alice", room(epic, x), 21).ticket;
    expect(epicClosed(sawX, room(sawX, x, y))).toBe(false);
  });

  it("an after gate on an epic uses the same rule: an unseen open ticket keeps it holding", () => {
    const php = into(done("php"), 1);
    const closed = turnEpic(epic, true, undefined, "alice", room(epic, php), 10).ticket;
    const rust = into(open("rust"), 11);
    const next = ticket({ id: "next", after: ["e1"] });
    expect(heldBy(next, room(closed, php, next))).toEqual([]);
    expect(heldBy(next, room(closed, php, rust, next))).toEqual(["e1"]);
  });

  it("the reason shown is the one behind the state — a slow clock's reopen, a close that missed an addition", () => {
    const php = into(done("php"), 1);
    const closed = turnEpic(epic, true, "shipped", "alice", room(epic, php), 100).ticket;
    // bob's clock runs behind: his reopen, made after seeing the close, is stamped earlier
    const reopened = turnEpic(closed, false, "Go next", "bob", room(closed, php), 50).ticket;
    expect(epicStatus(reopened, room(reopened, php))).toMatchObject({ closed: false, cause: { kind: "reopen", reason: "Go next", by: "bob" } });
    // a close that missed an addition: open, because of that ticket — and a reopen can still be recorded
    const rust = { ...into(open("rust"), 101), goal: "Rust on the review page" };
    const st = epicStatus(closed, room(closed, php, rust));
    expect(st.closed).toBe(false);
    expect(epicBecause(st, room(closed, php, rust), "alice")).toMatch(/"Rust on the review page" was put in without the close seeing it/);
    const said = turnEpic(closed, false, "Rust belongs here", "carol", room(closed, php, rust), 102);
    expect(said.outcome).toBe("turned");
    expect(epicBecause(epicStatus(said.ticket, room(said.ticket, php, rust)), room(said.ticket, php, rust), "carol")).toBe("Rust belongs here");
  });
});

describe("a ticket's title", () => {
  it("is the author's structure: the newer revision wins, either way round, and a peer's stale copy cannot drop it", () => {
    const v1 = ticket({ id: "t1", title: "Streamed export", goal: "stream the export, do not buffer it", structureAt: 1 });
    const v2 = { ...v1, title: "Paged export", structureAt: 2 };
    expect(mergeTicket(v1, v2).title).toBe("Paged export");
    expect(mergeTicket(v2, v1).title).toBe("Paged export");
    const stale = { ...v2, title: undefined, updatedAt: 9 };
    expect(mergeTicket(v2, { ...stale, structureAt: 2 }).title).toBe("Paged export");
    expect(ticketName(v2)).toBe("Paged export");
    expect(ticketName({ goal: "an old one" })).toBe("an old one");
  });
});
