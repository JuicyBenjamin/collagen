import { describe, expect, it } from "vitest";
import { actionableSteps, closeTicket, contributes, finished, mergeTicket, retireSteps, postReview, reviewStepId, settleStep, stepThreadId, type Ticket, type TicketStep } from "./ticket";
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
  structureAt: 1,
  kind: "task",
  steps: [],
  updatedAt: 1,
  ...over,
});

describe("mergeTicket", () => {
  it("unions steps by id", () => {
    const first = ticket({ steps: [step({ id: "s1" })] });
    const second = ticket({ steps: [step({ id: "s2", owner: "bob" })], updatedAt: 2 });
    const merged = mergeTicket(first, second);
    expect(merged.steps.map((ticketStep) => ticketStep.id).sort()).toEqual(["s1", "s2"]);
  });

  it("a settled step beats a pending one regardless of timestamps", () => {
    const pending = ticket({ steps: [step({ status: "pending", updatedAt: 99 })] });
    const settled = ticket({ steps: [step({ status: "settled", result: "done", updatedAt: 2 })] });
    expect(mergeTicket(pending, settled).steps[0]!.status).toBe("settled");
    expect(mergeTicket(settled, pending).steps[0]!.status).toBe("settled");
  });

  it("equal rank resolves by updatedAt, and merge is commutative", () => {
    const older = ticket({ steps: [step({ status: "settled", result: "old", updatedAt: 1 })] });
    const newer = ticket({ steps: [step({ status: "settled", result: "new", updatedAt: 2 })] });
    expect(mergeTicket(older, newer).steps[0]!.result).toBe("new");
    expect(mergeTicket(newer, older).steps[0]!.result).toBe("new");
  });

  it("converges regardless of arrival order (associative over three writers)", () => {
    const base = ticket({ steps: [step({ id: "s1" }), step({ id: "s2", owner: "bob" })] });
    const fromBob = ticket({ steps: [step({ id: "s2", owner: "bob", status: "settled", result: "bob did it", updatedAt: 5 })] });
    const fromCarol = ticket({ steps: [step({ id: "s1", status: "failed", result: "cannot", updatedAt: 4 })] });
    const bobThenCarol = mergeTicket(mergeTicket(base, fromBob), fromCarol);
    const carolThenBob = mergeTicket(mergeTicket(base, fromCarol), fromBob);
    const norm = (merged: Ticket) => JSON.stringify([...merged.steps].sort((a, b) => a.id.localeCompare(b.id)));
    expect(norm(bobThenCarol)).toBe(norm(carolThenBob));
  });

  it("ignores a different ticket id", () => {
    const first = ticket({});
    const other = ticket({ id: "other", steps: [step({})] });
    expect(mergeTicket(first, other).steps).toHaveLength(0);
  });
});

describe("actionableSteps", () => {
  it("returns own unsettled steps whose needs are settled", () => {
    const chain = ticket({
      steps: [
        step({ id: "a", owner: "bob", status: "settled" }),
        step({ id: "b", owner: "me", needs: ["a"], status: "pending" }),
        step({ id: "c", owner: "me", needs: ["missing"], status: "pending" }),
        step({ id: "d", owner: "other", status: "pending" }),
        step({ id: "e", owner: "me", status: "settled" }),
      ],
    });
    expect(actionableSteps(chain, "me").map((ticketStep) => ticketStep.id)).toEqual(["b"]);
  });
});

describe("stepThreadId", () => {
  const threaded = ticket({
    createdBy: "alice",
  structureAt: 1,
    steps: [
      step({ id: "work", owner: "bob" }),
      step({ id: "review", owner: "alice", needs: ["work"] }),
      step({ id: "solo", owner: "alice" }),
    ],
  });
  const pair = deriveThreadId("alice", "bob", "sandbox");

  it("a step given to a peer rides the creator↔owner conversation, same as a message", () => {
    expect(stepThreadId(threaded, threaded.steps[0]!)).toBe(pair);
  });
  it("the creator's review step continues the conversation with the peer it waits on", () => {
    expect(stepThreadId(threaded, threaded.steps[1]!)).toBe(pair);
  });
  it("a creator's step waiting on nobody else lands on the creator's own thread", () => {
    expect(stepThreadId(threaded, threaded.steps[2]!)).toBe(deriveThreadId("alice", "alice", "sandbox"));
  });
});

describe("shortRoomId", () => {
  it("is stable, label-independent, and 8 hex chars", async () => {
    const { shortRoomId } = await import("./topic");
    const shortId = shortRoomId("01a05f59-9427-7498-a36c-523ab2309b4a");
    expect(shortId).toMatch(/^[0-9a-f]{8}$/);
    expect(shortRoomId("01a05f59-9427-7498-a36c-523ab2309b4a")).toBe(shortId);
    expect(shortRoomId("другой")).not.toBe(shortId);
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
    const bobs = after.steps.find((ticketStep) => ticketStep.id === "review-bob")!;
    expect([bobs.owner, bobs.status, bobs.result]).toEqual([BOB.key, "settled", "bob's read"]);
    expect(after.steps.find((ticketStep) => ticketStep.id === "address")!.status).toBe("pending");
  });

  it("…and so can a second and a third, side by side", () => {
    const one = postReview(unaddressed, BOB, "bob's read", false, 5).ticket;
    const two = postReview(one, CAROL, "carol's read", false, 6).ticket;
    expect(two.steps.map((ticketStep) => ticketStep.id).sort()).toEqual(["address", "review-bob", "review-carol"]);
    expect(two.steps.find((ticketStep) => ticketStep.id === "review-bob")!.result).toBe("bob's read");
  });

  it("posting again revises your own review", () => {
    const one = postReview(unaddressed, BOB, "first read", false, 5).ticket;
    const two = postReview(one, BOB, "second read", false, 9).ticket;
    expect(two.steps.filter((ticketStep) => ticketStep.id === "review-bob")).toHaveLength(1);
    expect(two.steps.find((ticketStep) => ticketStep.id === "review-bob")!.result).toBe("second read");
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
    expect(actionableSteps(changes, ALICE).map((ticketStep) => ticketStep.id)).toEqual(["address"]);
    // and the same when he is happy with it
    const fine = postReview(asked, BOB, "looks right", false, 5).ticket;
    expect(actionableSteps(fine, ALICE).map((ticketStep) => ticketStep.id)).toEqual(["address"]);
  });

  it("finished is the close: every step answered, a reader's ↻ included; no steps is not finished", () => {
    const open = ticket({ kind: "review", createdBy: ALICE, steps: [step({ id: "address", owner: ALICE, intent: "address" })] });
    expect(finished(open)).toBe(false);
    const read = postReview(open, BOB, "wants changes", true, 5).ticket;
    expect(finished(read)).toBe(false); // the author has not acted yet
    const closed = { ...read, steps: read.steps.map((ticketStep) => (ticketStep.id === "address" ? { ...ticketStep, status: "settled" as const } : ticketStep)) };
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
    expect(closed.steps.find((ticketStep) => ticketStep.id === "review-bob")!.status).toBe("pending"); // untouched
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
    expect(changes.steps.find((ticketStep) => ticketStep.id === "review-bob")!.intent).toBe("take"); // the kind's word, kept
    expect(actionableSteps(changes, ALICE)).toEqual([]); // not answered — revise
    expect(finished(changes)).toBe(false);
    const agreed = postReview(changes, BOB, "streaming it is", false, 9).ticket;
    expect(actionableSteps(agreed, ALICE).map((ticketStep) => ticketStep.id)).toEqual(["address"]);
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
    expect(actionableSteps(proposal, BOB.key).map((ticketStep) => ticketStep.id)).toEqual(["review-bob"]); // his take is up, the work is not
    const declined = postReview(proposal, BOB, "not like this", true, 5).ticket;
    expect(actionableSteps(declined, BOB.key)).toEqual([]); // nothing owed after a ↻
    const accepted = postReview(proposal, BOB, "yes", false, 5).ticket;
    expect(actionableSteps(accepted, BOB.key).map((ticketStep) => ticketStep.id)).toEqual(["implement-bob"]);
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
    const build = done.ticket.steps.find((ticketStep) => ticketStep.id === "build-bob")!;
    expect(build.status).toBe("retired");
    expect(actionableSteps(done.ticket, BOB.key)).toEqual([]); // retired is never up
    expect(finished(done.ticket)).toBe(false); // address still pending
    // nothing waits on a retired step: a step needing it may go
    const waits = { ...done.ticket, steps: [...done.ticket.steps, step({ id: "after", owner: BOB.key, needs: ["build-bob"] })] };
    expect(actionableSteps(waits, BOB.key).map((ticketStep) => ticketStep.id)).toEqual(["after"]);
  });

  it("from and whenClosed can be withdrawn: an empty value wins a merge, absence keeps", () => {
    const withOrigin = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), from: ["p1"], whenClosed: "open the Jira tickets", structureAt: 1, updatedAt: 1 };
    const cleared = { ...withOrigin, from: [], whenClosed: "", structureAt: 2, updatedAt: 2 };
    expect(mergeTicket(withOrigin, cleared).from).toEqual([]);
    expect(mergeTicket(withOrigin, cleared).whenClosed).toBe("");
    const silent = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), structureAt: 0, updatedAt: 3 };
    expect(mergeTicket(withOrigin, silent).from).toEqual(["p1"]);
    expect(mergeTicket(withOrigin, silent).whenClosed).toBe("open the Jira tickets");
  });

  it("a stale peer's take cannot revert the author's structure: goal, from and whenClosed follow structureAt, not updatedAt", () => {
    const base = ticket({ createdBy: ALICE, steps: [step({ id: "review-bob", owner: BOB.key, intent: "take" })], kind: "plan" });
    // alice withdraws the close instruction and moves the goal: her clock advances
    const alice = { ...base, goal: "stream, paged by cursor", whenClosed: "", structureAt: 5, updatedAt: 5 };
    // bob posts a take from his OLDER copy — later wall clock, older structure
    const bob = postReview({ ...base, whenClosed: "open the Jira tickets", structureAt: 1 }, BOB, "fine", false, 9).ticket;
    for (const merged of [mergeTicket(alice, bob), mergeTicket(bob, alice)]) {
      expect(merged.goal).toBe("stream, paged by cursor");
      expect(merged.whenClosed).toBe(""); // withdrawn stays withdrawn
      expect(merged.structureAt).toBe(5);
      expect(merged.steps.find((ticketStep) => ticketStep.id === "review-bob")!.status).toBe("settled"); // his take still lands
      expect(merged.updatedAt).toBe(9);
    }
  });

  it("two author revisions in the same millisecond merge the same way from either side", () => {
    const base = ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })], updatedAt: 1 });
    const alpha = { ...base, goal: "alpha", structureAt: 5 };
    const beta = { ...base, goal: "beta", whenClosed: "mail it", structureAt: 5 };
    const alphaThenBeta = mergeTicket(alpha, beta);
    const betaThenAlpha = mergeTicket(beta, alpha);
    expect(alphaThenBeta.goal).toBe(betaThenAlpha.goal);
    expect(alphaThenBeta.whenClosed).toBe(betaThenAlpha.whenClosed);
    expect(alphaThenBeta.structureAt).toBe(5);
  });

  it("contributes: a copy that adds a step or a state changes the row; one that adds nothing does not", () => {
    const row = ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] });
    expect(contributes(row, row)).toBe(false);
    const older = { ...row, updatedAt: 0, structureAt: 0 };
    expect(contributes(row, older)).toBe(false); // nothing new in it
    const settled = { ...row, steps: [step({ id: "s1", owner: BOB.key, status: "settled" })] };
    expect(contributes(row, settled)).toBe(true);
    const another = { ...row, steps: [...row.steps, step({ id: "review-bob", owner: BOB.key, intent: "take", status: "failed" })] };
    expect(contributes(row, another)).toBe(true);
  });

  it("from and whenClosed ride the ticket through a merge", () => {
    const withOrigin = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), from: ["p1"], whenClosed: "open the Jira tickets", structureAt: 2 };
    const stale = { ...ticket({ createdBy: ALICE, steps: [step({ id: "s1", owner: BOB.key })] }), structureAt: 0, updatedAt: 0 };
    expect(mergeTicket(stale, withOrigin).from).toEqual(["p1"]);
    expect(mergeTicket(withOrigin, stale).whenClosed).toBe("open the Jira tickets");
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
    expect(actionableSteps(read, ALICE).map((ticketStep) => ticketStep.id)).toEqual(["address"]);
    const changes = postReview(unaddressed, BOB, "this needs work", true, 5).ticket;
    expect(actionableSteps(changes, ALICE).map((ticketStep) => ticketStep.id)).toEqual(["address"]);
  });
});

describe("settling a step", () => {
  const BOB = "b".repeat(64);
  const CAROL = "c".repeat(64);

  it("yours settles in place", () => {
    const bobsTicket = ticket({ createdBy: "alice", steps: [step({ id: "s1", owner: BOB })] });
    const done = settleStep(bobsTicket, "s1", BOB, "did it", false, 5)!;
    expect(done.outcome).toBe("settled");
    expect(done.ticket.steps[0]!.status).toBe("settled");
  });

  it("someone else's is refused, on any kind of ticket, and nothing changes", () => {
    for (const kind of ["task", "review"] as const) {
      const bobsTicket = ticket({ kind, createdBy: "alice", steps: [step({ id: "s1", owner: BOB })] });
      const done = settleStep(bobsTicket, "s1", CAROL, "not mine", false, 5)!;
      expect(done.outcome).toBe("not-yours");
      expect(done.ticket).toBe(bobsTicket);
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

describe("which agent did it", () => {
  it("a settle and a review name the agent beside the person; a later act by the person takes the name off", () => {
    const fixing = ticket({ steps: [step({ id: "s1", owner: "bob", intent: "fix" })] });
    const byCodex = settleStep(fixing, "s1", "bob", "done", false, 2, "Codex")!.ticket;
    expect(byCodex.steps[0]).toMatchObject({ owner: "bob", status: "settled", agent: "Codex" });
    const byBob = settleStep(byCodex, "s1", "bob", "done, again", false, 3)!.ticket;
    expect(byBob.steps[0]!.agent).toBeUndefined();
    const review = ticket({ kind: "review", steps: [] });
    const { ticket: taken, stepId } = postReview(review, { key: "carol", name: "Carol" }, "fine", false, 2, "Claude Code");
    expect(taken.steps.find((candidate) => candidate.id === stepId)).toMatchObject({ owner: "carol", agent: "Claude Code" });
  });

  it("a step's agent merges the same however copies are grouped", () => {
    const at = (agent?: string) => ticket({ steps: [step({ status: "settled", result: "same", updatedAt: 5, ...(agent ? { agent } : {}) })] });
    const copies = [at("Codex"), at("Claude Code"), at()];
    const results = new Set<string>();
    for (const [first, second, third] of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const) {
      results.add(JSON.stringify(mergeTicket(mergeTicket(copies[first]!, copies[second]!), copies[third]!).steps));
      results.add(JSON.stringify(mergeTicket(copies[first]!, mergeTicket(copies[second]!, copies[third]!)).steps));
    }
    expect(results.size).toBe(1);
  });

  it("the ticket's agent follows the author's latest revision, never a peer's later copy", () => {
    const filed = ticket({ agent: "Codex", structureAt: 1 });
    const amended = ticket({ agent: "Claude Code", structureAt: 3, goal: "fix average() properly" });
    const byHand = ticket({ structureAt: 4, goal: "fix it by hand" });
    const peer = ticket({ agent: "Codex", structureAt: 1, updatedAt: 9 });
    expect(mergeTicket(filed, amended).agent).toBe("Claude Code");
    expect(mergeTicket(amended, peer).agent).toBe("Claude Code");
    expect(mergeTicket(peer, amended).agent).toBe("Claude Code");
    expect(mergeTicket(amended, byHand).agent).toBeUndefined();
    expect(mergeTicket(byHand, amended).agent).toBeUndefined();
  });

  it("a record from before agents were named still reads", async () => {
    const { Schema } = await import("effect");
    const { Ticket } = await import("./ticket");
    const old = { id: "t1", project: "p", goal: "g", createdBy: "a", structureAt: 1, kind: "task", steps: [{ id: "s1", owner: "a", intent: "x", description: "d", needs: [], status: "settled", result: "r", updatedAt: 1 }], updatedAt: 1 };
    expect(Schema.decodeUnknownSync(Ticket)(old).steps[0]!.agent).toBeUndefined();
  });
});
