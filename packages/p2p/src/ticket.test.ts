import { describe, expect, it } from "vitest";
import { actionableSteps, closeTicket, finished, mergeTicket, retireSteps, postReview, reviewStepId, settleStep, stepThreadId, type Ticket, type TicketStep } from "./ticket";
import { deriveThreadId } from "./topic";

const step = (over: Partial<TicketStep>): TicketStep => ({
  id: "s1",
  owner: "alice",
  intent: "review",
  description: "look at it",
  needs: [],
  status: "pending",
  updatedAt: 1,
  ...over,
});

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t1",
  project: "sandbox",
  goal: "fix average()",
  createdBy: "alice",
  kind: "task",
  steps: [],
  updatedAt: 1,
  ...over,
});

describe("mergeTicket", () => {
  it("unions steps by id", () => {
    const a = ticket({ steps: [step({ id: "s1" })] });
    const b = ticket({ steps: [step({ id: "s2", owner: "bob" })], updatedAt: 2 });
    const m = mergeTicket(a, b);
    expect(m.steps.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("a settled step beats a pending one regardless of timestamps", () => {
    const a = ticket({ steps: [step({ status: "pending", updatedAt: 99 })] });
    const b = ticket({ steps: [step({ status: "settled", result: "done", updatedAt: 2 })] });
    expect(mergeTicket(a, b).steps[0]!.status).toBe("settled");
    expect(mergeTicket(b, a).steps[0]!.status).toBe("settled");
  });

  it("equal rank resolves by updatedAt, and merge is commutative", () => {
    const a = ticket({ steps: [step({ status: "settled", result: "old", updatedAt: 1 })] });
    const b = ticket({ steps: [step({ status: "settled", result: "new", updatedAt: 2 })] });
    expect(mergeTicket(a, b).steps[0]!.result).toBe("new");
    expect(mergeTicket(b, a).steps[0]!.result).toBe("new");
  });

  it("converges regardless of arrival order (associative over three writers)", () => {
    const base = ticket({ steps: [step({ id: "s1" }), step({ id: "s2", owner: "bob" })] });
    const fromBob = ticket({ steps: [step({ id: "s2", owner: "bob", status: "settled", result: "bob did it", updatedAt: 5 })] });
    const fromCarol = ticket({ steps: [step({ id: "s1", status: "failed", result: "cannot", updatedAt: 4 })] });
    const ab = mergeTicket(mergeTicket(base, fromBob), fromCarol);
    const ba = mergeTicket(mergeTicket(base, fromCarol), fromBob);
    const norm = (x: Ticket) => JSON.stringify([...x.steps].sort((p, q) => p.id.localeCompare(q.id)));
    expect(norm(ab)).toBe(norm(ba));
  });

  it("ignores a different ticket id", () => {
    const a = ticket({});
    const b = ticket({ id: "other", steps: [step({})] });
    expect(mergeTicket(a, b).steps).toHaveLength(0);
  });
});

describe("actionableSteps", () => {
  it("returns own unsettled steps whose needs are settled", () => {
    const t = ticket({
      steps: [
        step({ id: "a", owner: "bob", status: "settled" }),
        step({ id: "b", owner: "me", needs: ["a"], status: "pending" }),
        step({ id: "c", owner: "me", needs: ["missing"], status: "pending" }),
        step({ id: "d", owner: "other", status: "pending" }),
        step({ id: "e", owner: "me", status: "settled" }),
      ],
    });
    expect(actionableSteps(t, "me").map((s) => s.id)).toEqual(["b"]);
  });
});

describe("stepThreadId", () => {
  const t = ticket({
    createdBy: "alice",
    steps: [
      step({ id: "work", owner: "bob" }),
      step({ id: "review", owner: "alice", needs: ["work"] }),
      step({ id: "solo", owner: "alice" }),
    ],
  });
  const pair = deriveThreadId("alice", "bob", "sandbox");

  it("a step given to a peer rides the creator↔owner conversation, same as a message", () => {
    expect(stepThreadId(t, t.steps[0]!)).toBe(pair);
  });
  it("the creator's review step continues the conversation with the peer it waits on", () => {
    expect(stepThreadId(t, t.steps[1]!)).toBe(pair);
  });
  it("a creator's step waiting on nobody else lands on the creator's own thread", () => {
    expect(stepThreadId(t, t.steps[2]!)).toBe(deriveThreadId("alice", "alice", "sandbox"));
  });
});

describe("shortRoomId", () => {
  it("is stable, label-independent, and 8 hex chars", async () => {
    const { shortRoomId } = await import("./topic");
    const a = shortRoomId("01a05f59-9427-7498-a36c-523ab2309b4a");
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(shortRoomId("01a05f59-9427-7498-a36c-523ab2309b4a")).toBe(a);
    expect(shortRoomId("другой")).not.toBe(a);
  });
});

describe("a review ticket asks 0 to many people", () => {
  const ALICE = "a".repeat(64);
  const BOB = { key: "b".repeat(64), name: "bob" };
  const CAROL = { key: "c".repeat(64), name: "carol" };
  // nobody asked: the ticket carries the why and the author's own step. There
  // is NO placeholder step for "somebody, eventually" — a step exists when a
  // person has something on it.
  const unaddressed = ticket({
    kind: "review",
    createdBy: ALICE,
    steps: [step({ id: "address", owner: ALICE, intent: "address", needs: [] })],
  });

  it("a reader who was not asked posts their own review, and takes nothing", () => {
    const { ticket: after, stepId } = postReview(unaddressed, BOB, "bob's read", false, 5);
    expect(stepId).toBe("review-bob");
    const bobs = after.steps.find((s) => s.id === "review-bob")!;
    expect([bobs.owner, bobs.status, bobs.result]).toEqual([BOB.key, "settled", "bob's read"]);
    expect(after.steps.find((s) => s.id === "address")!.status).toBe("pending");
  });

  it("…and so can a second and a third, side by side", () => {
    const one = postReview(unaddressed, BOB, "bob's read", false, 5).ticket;
    const two = postReview(one, CAROL, "carol's read", false, 6).ticket;
    expect(two.steps.map((s) => s.id).sort()).toEqual(["address", "review-bob", "review-carol"]);
    expect(two.steps.find((s) => s.id === "review-bob")!.result).toBe("bob's read");
  });

  it("posting again revises your own review", () => {
    const one = postReview(unaddressed, BOB, "first read", false, 5).ticket;
    const two = postReview(one, BOB, "second read", false, 9).ticket;
    expect(two.steps.filter((s) => s.id === "review-bob")).toHaveLength(1);
    expect(two.steps.find((s) => s.id === "review-bob")!.result).toBe("second read");
  });

  it("a reader who WAS asked posts onto the step they were given", () => {
    const asked = ticket({
      kind: "review",
      createdBy: ALICE,
      steps: [step({ id: "review-bob", owner: BOB.key, intent: "review" }), step({ id: "address", owner: ALICE, needs: ["review-bob"] })],
    });
    const { ticket: after, stepId } = postReview(asked, BOB, "read it", false, 5);
    expect(stepId).toBe("review-bob");
    expect(after.steps).toHaveLength(2); // no second step of his own
  });

  it("nothing is pushed to anyone for a review nobody was asked for — its own author included", () => {
    expect(actionableSteps(unaddressed, BOB.key)).toEqual([]);
    // the author's "address" step names nobody, so the dependency rule alone
    // would hand it straight back to them: there is nothing to address yet
    expect(actionableSteps(unaddressed, ALICE)).toEqual([]);
  });

  it("a reviewer who was ASKED and wants changes unblocks the author — a change request is an answer", () => {
    const asked = ticket({
      kind: "review",
      createdBy: ALICE,
      steps: [step({ id: "review-bob", owner: BOB.key, intent: "review" }), step({ id: "address", owner: ALICE, needs: ["review-bob"] })],
    });
    // nothing yet: the author waits for bob
    expect(actionableSteps(asked, ALICE)).toEqual([]);
    const changes = postReview(asked, BOB, "the interval leaks on unmount", true, 5).ticket;
    expect(actionableSteps(changes, ALICE).map((s) => s.id)).toEqual(["address"]);
    // and the same when he is happy with it
    const fine = postReview(asked, BOB, "looks right", false, 5).ticket;
    expect(actionableSteps(fine, ALICE).map((s) => s.id)).toEqual(["address"]);
  });

  it("finished is the close: every step answered, a reader's ↻ included; no steps is not finished", () => {
    const open = ticket({ kind: "review", createdBy: ALICE, steps: [step({ id: "address", owner: ALICE, intent: "address" })] });
    expect(finished(open)).toBe(false);
    const read = postReview(open, BOB, "wants changes", true, 5).ticket;
    expect(finished(read)).toBe(false); // the author has not acted yet
    const closed = { ...read, steps: read.steps.map((s) => (s.id === "address" ? { ...s, status: "settled" as const } : s)) };
    expect(finished(closed)).toBe(true);
    expect(finished(ticket({ createdBy: ALICE, steps: [] }))).toBe(false);
    expect(finished(ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key, status: "failed" })] }))).toBe(false);
  });

  it("closing is the author's decision, recorded, with the steps as they were", () => {
    const open = ticket({ kind: "review", createdBy: ALICE, steps: [step({ id: "review-bob", owner: BOB.key, intent: "review" }), step({ id: "address", owner: ALICE, needs: ["review-bob"] })] });
    // bob never answered; alice closes anyway
    expect(closeTicket(open, BOB.key, undefined, 5).outcome).toBe("not-yours");
    const { ticket: closed, outcome } = closeTicket(open, ALICE, "superseded by the streaming plan", 5);
    expect(outcome).toBe("closed");
    expect(closed.closed).toEqual({ by: ALICE, ts: 5, reason: "superseded by the streaming plan" });
    expect(closed.steps.find((s) => s.id === "review-bob")!.status).toBe("pending"); // untouched
    expect(finished(closed)).toBe(false); // completion and closure are two facts
    expect(closeTicket(closed, ALICE, undefined, 9).outcome).toBe("already");
  });

  it("closed sticks through a merge: a copy written before the close cannot reopen it", () => {
    const open = ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] });
    const closed = closeTicket(open, ALICE, undefined, 5).ticket;
    const stale = { ...open, updatedAt: 7 }; // newer clock, no close
    expect(mergeTicket(closed, stale).closed).toEqual(closed.closed);
    expect(mergeTicket(stale, closed).closed).toEqual(closed.closed);
    // two closes: the earlier one is the record
    const again = { ...open, closed: { by: ALICE, ts: 3 } };
    expect(mergeTicket(closed, again).closed?.ts).toBe(3);
  });

  it("on a plan, a reader's ↻ is not an answer: the author revises, and the ticket waits for the ✓", () => {
    const plan = ticket({ kind: "plan", createdBy: ALICE, steps: [step({ id: "review-bob", owner: BOB.key, intent: "take" }), step({ id: "address", owner: ALICE, needs: ["review-bob"] })] });
    const changes = postReview(plan, BOB, "buffer it instead", true, 5).ticket;
    expect(changes.steps.find((s) => s.id === "review-bob")!.intent).toBe("take"); // the kind's word, kept
    expect(actionableSteps(changes, ALICE)).toEqual([]); // not answered — revise
    expect(finished(changes)).toBe(false);
    const agreed = postReview(changes, BOB, "streaming it is", false, 9).ticket;
    expect(actionableSteps(agreed, ALICE).map((s) => s.id)).toEqual(["address"]);
  });

  it("a proposal's work starts on the recipient's ✓ and not before", () => {
    const proposal = ticket({
      kind: "proposal",
      createdBy: ALICE,
      steps: [
        step({ id: "review-bob", owner: BOB.key, intent: "take" }),
        step({ id: "implement-bob", owner: BOB.key, intent: "implement", needs: ["review-bob"] }),
        step({ id: "address", owner: ALICE, needs: ["review-bob"] }),
      ],
    });
    expect(actionableSteps(proposal, BOB.key).map((s) => s.id)).toEqual(["review-bob"]); // his take is up, the work is not
    const declined = postReview(proposal, BOB, "not like this", true, 5).ticket;
    expect(actionableSteps(declined, BOB.key)).toEqual([]); // nothing owed after a ↻
    const accepted = postReview(proposal, BOB, "yes", false, 5).ticket;
    expect(actionableSteps(accepted, BOB.key).map((s) => s.id)).toEqual(["implement-bob"]);
  });

  it("retiring work is explicit and keeps history: never actionable, nothing waits on it, answered work stands", () => {
    const proposal = ticket({
      kind: "proposal",
      createdBy: ALICE,
      steps: [
        step({ id: "review-bob", owner: BOB.key, intent: "take", status: "settled" }),
        step({ id: "build-bob", owner: BOB.key, intent: "build", needs: ["review-bob"] }),
        step({ id: "mail-bob", owner: BOB.key, intent: "mail", needs: ["review-bob"], status: "settled" }),
        step({ id: "address", owner: ALICE, needs: ["review-bob"] }),
      ],
    });
    expect(retireSteps(proposal, ["build-bob"], BOB.key, 5).outcome).toBe("not-yours");
    const done = retireSteps(proposal, ["build-bob", "mail-bob", "nope-bob"], ALICE, 5);
    expect(done.outcome).toBe("retired");
    if (done.outcome !== "retired") throw new Error("unreachable");
    expect(done.retired).toEqual(["build-bob"]);
    expect(done.kept).toEqual(["mail-bob"]); // settled work is what happened
    const build = done.ticket.steps.find((s) => s.id === "build-bob")!;
    expect(build.status).toBe("retired");
    expect(actionableSteps(done.ticket, BOB.key)).toEqual([]); // retired is never up
    expect(finished(done.ticket)).toBe(false); // address still pending
    // nothing waits on a retired step: a step needing it may go
    const waits = { ...done.ticket, steps: [...done.ticket.steps, step({ id: "after", owner: BOB.key, needs: ["build-bob"] })] };
    expect(actionableSteps(waits, BOB.key).map((s) => s.id)).toEqual(["after"]);
  });

  it("from and whenClosed can be withdrawn: an empty value wins a merge, absence keeps", () => {
    const t = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), from: ["p1"], whenClosed: "open the Jira tickets", updatedAt: 1 };
    const cleared = { ...t, from: [], whenClosed: "", updatedAt: 2 };
    expect(mergeTicket(t, cleared).from).toEqual([]);
    expect(mergeTicket(t, cleared).whenClosed).toBe("");
    const silent = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), updatedAt: 3 };
    expect(mergeTicket(t, silent).from).toEqual(["p1"]);
    expect(mergeTicket(t, silent).whenClosed).toBe("open the Jira tickets");
  });

  it("from and whenClosed ride the ticket through a merge", () => {
    const t = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), from: ["p1"], whenClosed: "open the Jira tickets" };
    const stale = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), updatedAt: 0 };
    expect(mergeTicket(stale, t).from).toEqual(["p1"]);
    expect(mergeTicket(t, stale).whenClosed).toBe("open the Jira tickets");
  });

  it("a FAILED task step still blocks what waits on it — only a review reads failure as an answer", () => {
    const task = ticket({
      createdBy: ALICE,
      steps: [step({ id: "s1", owner: BOB.key, status: "failed" }), step({ id: "s2", owner: ALICE, needs: ["s1"] })],
    });
    expect(actionableSteps(task, ALICE)).toEqual([]);
  });

  it("…and it becomes the author's the moment a review lands", () => {
    const read = postReview(unaddressed, BOB, "looks right to me", false, 5).ticket;
    expect(actionableSteps(read, ALICE).map((s) => s.id)).toEqual(["address"]);
    const changes = postReview(unaddressed, BOB, "this needs work", true, 5).ticket;
    expect(actionableSteps(changes, ALICE).map((s) => s.id)).toEqual(["address"]);
  });
});

describe("settling a step", () => {
  const BOB = "b".repeat(64);
  const CAROL = "c".repeat(64);

  it("yours settles in place", () => {
    const t = ticket({ createdBy: "alice", steps: [step({ id: "s1", owner: BOB })] });
    const done = settleStep(t, "s1", BOB, "did it", false, 5)!;
    expect(done.outcome).toBe("settled");
    expect(done.ticket.steps[0]!.status).toBe("settled");
  });

  it("someone else's is refused, on any kind of ticket, and nothing changes", () => {
    for (const kind of ["task", "review"] as const) {
      const t = ticket({ kind, createdBy: "alice", steps: [step({ id: "s1", owner: BOB })] });
      const done = settleStep(t, "s1", CAROL, "not mine", false, 5)!;
      expect(done.outcome).toBe("not-yours");
      expect(done.ticket).toBe(t);
    }
  });

  it("a step that isn't there is nothing at all", () => {
    expect(settleStep(ticket({ createdBy: "alice", steps: [] }), "nope", BOB, "x", false, 5)).toBe(null);
  });
});

describe("where a reader's own review lands", () => {
  const KEY = "b".repeat(64);
  it("is named after them, and reviewing again reuses it", () => {
    expect(reviewStepId("bob", KEY, new Map())).toBe("review-bob");
    expect(reviewStepId("bob", KEY, new Map([["review-bob", KEY]]))).toBe("review-bob");
  });

  it("never lands on someone else's step, even with the same display name", () => {
    expect(reviewStepId("bob", KEY, new Map([["review-bob", "c".repeat(64)]]))).toBe(`review-bob-${KEY.slice(0, 4)}`);
  });

  it("a name that slugs to nothing still gets an id", () => {
    expect(reviewStepId("···", KEY, new Map())).toBe("review-peer");
    expect(reviewStepId("Kristian B.", KEY, new Map())).toBe("review-kristian-b");
  });
});
