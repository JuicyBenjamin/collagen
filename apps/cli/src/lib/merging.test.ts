import { describe, expect, it } from "vitest";
import type { Ticket, TicketStep } from "@collagen/p2p";
import { hostReadiness, joinedRoom, mergeForOf, ticketReadiness, withMergeFor, type HostReadiness } from "./merging";

const take = (owner: string, status: TicketStep["status"]): TicketStep => ({ id: `review-${owner}`, owner, intent: "review", description: "review it", needs: [], status, updatedAt: 1 });
const address: TicketStep = { id: "address", owner: "me", intent: "address", description: "act on the reviews", needs: [], status: "pending", updatedAt: 1 };
const review = (...takes: ReadonlyArray<TicketStep>): Ticket => ({ id: "t1", project: "collagen", goal: "a change", createdBy: "me", kind: "review", steps: [...takes, address], structureAt: 1, updatedAt: 1 });
const names = (key: string) => ({ me: "Juicy", bob: "Bob", carol: "Carol" })[key] ?? key;
const green: HostReadiness = { state: "open", draft: false, checks: "passing", conflicts: false, approvalRequired: false, changesRequested: false };

describe("whether a review is ready to be merged for its author", () => {
  it("off never merges, however approved", () => {
    expect(ticketReadiness(review(take("bob", "settled"), take("me", "settled")), "me", "off", names)).toEqual({ never: "merging for you is off" });
  });

  it("theirs merges on someone else's approval, not on the author's own", () => {
    expect(ticketReadiness(review(take("bob", "settled")), "me", "theirs", names)).toEqual({ merge: true });
    expect(ticketReadiness(review(take("me", "settled")), "me", "theirs", names)).toEqual({ waiting: "waiting for someone else to approve it" });
  });

  it("mine merges on the author's accept alone", () => {
    expect(ticketReadiness(review(take("me", "settled")), "me", "mine", names)).toEqual({ merge: true });
    expect(ticketReadiness(review(take("bob", "settled")), "me", "mine", names)).toEqual({ waiting: "waiting for you to accept it" });
  });

  it("both waits for each", () => {
    expect(ticketReadiness(review(take("bob", "settled")), "me", "both", names)).toEqual({ waiting: "waiting for you to accept it" });
    expect(ticketReadiness(review(take("bob", "settled"), take("me", "settled")), "me", "both", names)).toEqual({ merge: true });
  });

  it("a take that only comments approves nothing, theirs or the author's own", () => {
    const comment = (owner: string): TicketStep => ({ ...take(owner, "settled"), comment: true });
    expect(ticketReadiness(review(comment("bob")), "me", "theirs", names)).toEqual({ waiting: "waiting for someone else to approve it" });
    expect(ticketReadiness(review(comment("me")), "me", "mine", names)).toEqual({ waiting: "waiting for you to accept it" });
    expect(ticketReadiness(review(comment("bob"), take("carol", "settled")), "me", "theirs", names)).toEqual({ merge: true });
  });

  it("a take asking for changes, or a named reviewer yet to answer, holds it", () => {
    expect(ticketReadiness(review(take("bob", "settled"), take("carol", "failed")), "me", "theirs", names)).toEqual({ waiting: "Carol asked for changes" });
    expect(ticketReadiness(review(take("bob", "settled"), take("carol", "pending")), "me", "theirs", names)).toEqual({ waiting: "waiting on Carol's review" });
  });

  it("only its author's collagen merges it, and never a closed one", () => {
    expect(ticketReadiness({ ...review(take("bob", "settled")), createdBy: "bob" }, "me", "theirs", names)).toEqual({ never: "only its author's collagen merges it" });
    expect(ticketReadiness({ ...review(take("bob", "settled")), closed: { by: "me", ts: 2, outcome: "done" } }, "me", "theirs", names)).toEqual({ never: "the review is closed" });
  });

  it("the host's own rules come first: an approval it requires, checks, conflicts", () => {
    expect(hostReadiness(green, "GitHub")).toEqual({ merge: true });
    expect(hostReadiness({ ...green, approvalRequired: true }, "GitHub")).toEqual({ waiting: "GitHub's rules for this repository want an approval it has not had" });
    expect(hostReadiness({ ...green, checks: "pending" }, "GitHub")).toEqual({ waiting: "its checks are still running" });
    expect(hostReadiness({ ...green, checks: "failing" }, "GitHub")).toEqual({ waiting: "its checks are failing" });
    expect(hostReadiness({ ...green, conflicts: true }, "GitHub")).toEqual({ waiting: "it conflicts with its base" });
    expect(hostReadiness({ ...green, checks: "none" }, "GitHub")).toEqual({ merge: true });
  });
});

describe("whose approval a review waits for, by layer", () => {
  it("a review's own beats its room's, which beats the default; nothing set is off", () => {
    expect(mergeForOf({}, "room1", "t1")).toBe("off");
    const state = withMergeFor(withMergeFor(withMergeFor({}, { default: true }, "theirs"), { room: "room1" }, "mine"), { ticket: "t1" }, "both");
    expect(mergeForOf(state, "room1", "t1")).toBe("both");
    expect(mergeForOf(state, "room1", "t2")).toBe("mine");
    expect(mergeForOf(state, "room2", "t2")).toBe("theirs");
    expect(mergeForOf(withMergeFor(state, { ticket: "t1" }, null), "room1", "t1")).toBe("mine");
  });

  it("a room joined takes the default then, and keeps it when the default changes", () => {
    const joined = joinedRoom(withMergeFor({}, { default: true }, "theirs"), "work");
    const changed = withMergeFor(joined, { default: true }, "mine");
    expect(mergeForOf(changed, "work", "t1")).toBe("theirs");
    expect(mergeForOf(joinedRoom(changed, "side"), "side", "t1")).toBe("mine");
  });
});
