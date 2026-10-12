import { describe, expect, it } from "vitest";
import { stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
import { age, compareSummaries, marksLabel, summarize } from "./ticketSummary";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const names: Record<string, string> = { [ALICE]: "you", [BOB]: "bob", [CAROL]: "carol" };
const nameFor = (key: string) => names[key] ?? key.slice(0, 8);

const ticket = (steps: Ticket["steps"], updatedAt = 1000): Ticket => ({ id: "t1", project: "sandbox", goal: "fix NaN", createdBy: ALICE, kind: "task", structureAt: updatedAt, updatedAt, steps });
const step = (id: string, owner: string, status: Ticket["steps"][number]["status"], needs: string[] = []): Ticket["steps"][number] => ({
  id,
  owner,
  intent: "do",
  description: "…",
  needs,
  status,
  updatedAt: 1,
});
const messageFrom = (from: string, extra: Partial<RoomMessage> = {}): RoomMessage => ({
  id: Math.random().toString(36),
  threadId: "zzzz",
  from,
  fromName: nameFor(from),
  to: ALICE,
  project: "sandbox",
  intent: "say",
  findings: "…",
  ts: 2000,
  ...extra,
});

describe("summarize", () => {
  it("needs you when a step you own is up; waiting on the other owner otherwise", () => {
    const subject = ticket([step("s1", BOB, "pending"), step("s2", ALICE, "pending", ["s1"])]);
    const summary = summarize(subject, [], ALICE);
    expect(summary.state).toBe("waiting");
    expect(summary.waitingOn).toEqual([BOB]);
    const later = summarize(ticket([step("s1", BOB, "settled"), step("s2", ALICE, "pending", ["s1"])]), [], ALICE);
    expect(later.state).toBe("needs-you");
  });

  it("finished when every step is answered: the author's to close, done to everyone else; failed when one failed and nothing is up", () => {
    expect(summarize(ticket([step("s1", BOB, "settled")]), [], ALICE).state).toBe("needs-you");
    expect(summarize(ticket([step("s1", BOB, "settled")]), [], BOB).state).toBe("done");
    expect(summarize(ticket([step("s1", BOB, "failed")]), [], ALICE).state).toBe("failed");
  });

  it("who weighed in: tagged messages from anyone, untagged ones on the ticket's threads, settlers", () => {
    const subject = ticket([step("s1", BOB, "settled"), step("s2", ALICE, "pending", ["s1"])]);
    const onThread = messageFrom(BOB, { threadId: stepThreadId(subject, subject.steps[0]!) });
    const tagged = messageFrom(CAROL, { ticketId: "t1" });
    const unrelated = messageFrom(CAROL, { threadId: "other" });
    const summary = summarize(subject, [onThread, tagged, tagged, unrelated], ALICE);
    expect([...summary.weighedIn.entries()]).toEqual([
      [BOB, 1],
      [CAROL, 2],
    ]);
    expect(summary.settledBy).toEqual(new Set([BOB]));
    expect(summary.asked).toEqual([BOB, ALICE]);
    expect(summary.lastActivity).toBe(2000);
  });

  it("marksLabel: what was said, not by whom — one glyph per kind of answer", () => {
    const subject = ticket([step("s1", BOB, "pending"), step("s2", ALICE, "pending", ["s1"])]);
    // nobody has answered; carol spoke without being asked
    expect(marksLabel(summarize(subject, [messageFrom(CAROL, { ticketId: "t1" })], ALICE))).toBe("…");
    expect(marksLabel(summarize(ticket([step("s1", BOB, "settled")]), [], ALICE))).toBe("✓");
    expect(marksLabel(summarize(subject, [], ALICE))).toBe("");
  });

  it("two approvals and one change request read as ↻ ✓ — the count is not the point", () => {
    const review = {
      ...ticket([
        step("review-bob", BOB, "settled"),
        step("review-carol", CAROL, "settled"),
        step("review-dave", "d".repeat(64), "failed"),
        step("address", ALICE, "pending"),
      ]),
      kind: "review" as const,
    };
    const withIntents = { ...review, steps: review.steps.map((ticketStep) => (ticketStep.id.startsWith("review-") ? { ...ticketStep, intent: "review" } : ticketStep)) };
    expect(marksLabel(summarize(withIntents, [], ALICE))).toBe("↻ ✓");
  });

  it("a review asking for changes is not a tick and not a failure: ↻", () => {
    const asked = { ...ticket([step("s1", BOB, "failed")]), kind: "review" as const };
    const reviewStep = { ...asked, steps: [{ ...asked.steps[0]!, intent: "review" }] };
    expect(marksLabel(summarize(reviewStep, [], ALICE))).toBe("↻");
    // the same failed status on a task step is a failure, and says so
    expect(marksLabel(summarize(ticket([step("s1", BOB, "failed")]), [], ALICE))).toBe("✕");
  });

  it("the overview agrees with the agent nudges: an open review is not needs-you", () => {
    // nobody asked, so nothing has been reviewed: the row must not shout
    const open = { ...ticket([step("address", ALICE, "pending")]), kind: "review" as const };
    const withIntent = { ...open, steps: [{ ...open.steps[0]!, intent: "address" }] };
    expect(summarize(withIntent, [], ALICE).state).toBe("waiting");
    // once a reader has posted, it is the author's to act on
    const read = {
      ...withIntent,
      steps: [...withIntent.steps, { ...step("review-bob", BOB, "failed"), intent: "review" }],
    };
    expect(summarize(read, [], ALICE).state).toBe("needs-you");
  });

  it("completion is a signal, closure is a decision: finished-but-open is the author's to close", () => {
    const review = {
      ...ticket([
        { ...step("review-bob", BOB, "failed"), intent: "review" },
        { ...step("address", ALICE, "settled"), intent: "address" },
      ]),
      kind: "review" as const,
    };
    // every step answered, not closed: needs the author (to close), "done" to anyone else
    expect(summarize(review, [], ALICE).state).toBe("needs-you");
    expect(summarize(review, [], BOB).state).toBe("done");
    // closed: off the lists for everyone, whatever the steps say
    const closed = { ...review, closed: { by: ALICE, ts: 9 } };
    expect(summarize(closed, [], ALICE).state).toBe("closed");
    expect(summarize(closed, [], BOB).state).toBe("closed");
    // on a task, a failed step is unfinished work: not done, and it says failed
    const task = ticket([step("s1", BOB, "failed"), step("s2", ALICE, "settled")]);
    expect(summarize(task, [], ALICE).state).toBe("failed");
  });

  it("your own review on your own ticket is a mark, said as yours; settling your address step is not a tick", () => {
    const solo = {
      ...ticket([
        { ...step("address", ALICE, "settled"), intent: "address" },
        { ...step("review-alice", ALICE, "failed"), intent: "review" },
      ]),
      kind: "review" as const,
    };
    expect(marksLabel(summarize(solo, [], ALICE))).toBe("self ↻");
    const plain = { ...ticket([{ ...step("address", ALICE, "settled"), intent: "address" }]), kind: "review" as const };
    expect(marksLabel(summarize(plain, [], ALICE))).toBe("");
  });

  it("your own review given by one of your agents says which: a second agent's ✓ is not your own word", () => {
    const solo = {
      ...ticket([{ ...step("review-alice", ALICE, "settled"), intent: "review", agent: "Codex" }]),
      kind: "review" as const,
    };
    expect(marksLabel(summarize(solo, [], ALICE))).toBe("self ✓ via Codex");
  });

  it("the author's own take is theirs on the row: self ✓, never mistaken for a colleague's", () => {
    // alice proposes, takes her own idea, and bob asks for changes
    const own = {
      ...ticket([
        { ...step("review-you", ALICE, "settled"), intent: "take" },
        { ...step("review-bob", BOB, "failed"), intent: "take" },
        { ...step("address", ALICE, "pending"), intent: "address" },
      ]),
      kind: "proposal" as const,
    };
    expect(marksLabel(summarize(own, [], ALICE))).toBe("↻ self ✓");
    // seen from bob's side the words are the same: it is about the author, not the viewer
    expect(marksLabel(summarize(own, [], BOB))).toBe("↻ self ✓");
    // alone, a self-approval is only that
    const solo = { ...own, steps: own.steps.filter((ticketStep) => ticketStep.owner === ALICE) };
    expect(marksLabel(summarize(solo, [], ALICE))).toBe("self ✓");
  });

  it("says whose ticket it is, which is what the reader's own name used to imply", () => {
    expect(summarize(ticket([step("s1", BOB, "pending")]), [], ALICE).mine).toBe(true);
    expect(summarize(ticket([step("s1", BOB, "pending")]), [], BOB).mine).toBe(false);
  });

  it("orders needs-you, waiting, failed, done; newest activity first within a state", () => {
    const mineToAct = summarize(ticket([step("s1", ALICE, "pending")], 10), [], ALICE);
    const waitingEarly = summarize(ticket([step("s1", BOB, "pending")], 50), [], ALICE);
    const waitingLate = summarize(ticket([step("s1", BOB, "pending")], 90), [], ALICE);
    const finished = summarize(ticket([step("s1", BOB, "settled")], 99), [], BOB); // finished, and not bob's to close: done
    expect([finished, waitingEarly, mineToAct, waitingLate].sort(compareSummaries).map((summary) => summary.lastActivity)).toEqual([10, 90, 50, 99]);
  });

  it("age is compact", () => {
    const now = 1_000_000_000;
    expect(age(now - 20_000, now)).toBe("now");
    expect(age(now - 5 * 60_000, now)).toBe("5m");
    expect(age(now - 3 * 3_600_000, now)).toBe("3h");
    expect(age(now - 2 * 86_400_000, now)).toBe("2d");
  });
});

describe("a review nobody was asked for", () => {
  it("is the author's to shepherd, and reads waiting for everyone else", () => {
    // no placeholder step: the author's own step is all there is until a
    // reader posts theirs
    const reviewTicket: Ticket = { ...ticket([step("address", ALICE, "pending")]), kind: "review" };
    expect(summarize(reviewTicket, [], ALICE).state).toBe("needs-you");
    expect(summarize(reviewTicket, [], BOB).state).toBe("waiting");
  });

  it("a reader's posted review does not finish it — the author's step does", () => {
    const read: Ticket = { ...ticket([step("review-bob", BOB, "settled"), step("address", ALICE, "pending")]), kind: "review" };
    expect(summarize(read, [], ALICE).state).toBe("needs-you");
    expect(summarize(read, [], ALICE).settledBy.has(BOB)).toBe(true);
    const acted: Ticket = { ...ticket([step("review-bob", BOB, "settled"), step("address", ALICE, "settled")]), kind: "review" };
    // finished — and so the author's to close; done, to bob
    expect(summarize(acted, [], ALICE).state).toBe("needs-you");
    expect(summarize(acted, [], BOB).state).toBe("done");
  });

  it("a ticket with no steps at all is not done", () => {
    expect(summarize(ticket([]), [], ALICE).state).toBe("waiting");
  });
});
