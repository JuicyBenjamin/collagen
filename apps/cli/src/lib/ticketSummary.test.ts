import { describe, expect, it } from "vitest";
import { stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
import { age, compareSummaries, peopleLabel, summarize } from "./ticketSummary";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const names: Record<string, string> = { [ALICE]: "you", [BOB]: "bob", [CAROL]: "carol" };
const nameFor = (k: string) => names[k] ?? k.slice(0, 8);

const ticket = (steps: Ticket["steps"], updatedAt = 1000): Ticket => ({ id: "t1", project: "sandbox", goal: "fix NaN", createdBy: ALICE, kind: "task", updatedAt, steps });
const step = (id: string, owner: string, status: Ticket["steps"][number]["status"], needs: string[] = []): Ticket["steps"][number] => ({
  id,
  owner,
  intent: "do",
  description: "…",
  needs,
  status,
  updatedAt: 1,
});
const msg = (from: string, extra: Partial<RoomMessage> = {}): RoomMessage => ({
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
    const t = ticket([step("s1", BOB, "pending"), step("s2", ALICE, "pending", ["s1"])]);
    const s = summarize(t, [], ALICE);
    expect(s.state).toBe("waiting");
    expect(s.waitingOn).toEqual([BOB]);
    const later = summarize(ticket([step("s1", BOB, "settled"), step("s2", ALICE, "pending", ["s1"])]), [], ALICE);
    expect(later.state).toBe("needs-you");
  });

  it("done when every step settled; failed when one failed and nothing is up", () => {
    expect(summarize(ticket([step("s1", BOB, "settled")]), [], ALICE).state).toBe("done");
    expect(summarize(ticket([step("s1", BOB, "failed")]), [], ALICE).state).toBe("failed");
  });

  it("who weighed in: tagged messages from anyone, untagged ones on the ticket's threads, settlers", () => {
    const t = ticket([step("s1", BOB, "settled"), step("s2", ALICE, "pending", ["s1"])]);
    const onThread = msg(BOB, { threadId: stepThreadId(t, t.steps[0]!) });
    const tagged = msg(CAROL, { ticketId: "t1" });
    const unrelated = msg(CAROL, { threadId: "other" });
    const s = summarize(t, [onThread, tagged, tagged, unrelated], ALICE);
    expect([...s.weighedIn.entries()]).toEqual([
      [BOB, 1],
      [CAROL, 2],
    ]);
    expect(s.settledBy).toEqual(new Set([BOB]));
    expect(s.asked).toEqual([BOB, ALICE]);
    expect(s.lastActivity).toBe(2000);
  });

  it("peopleLabel: a mark a space off each name — whose turn, what they said, what they asked for", () => {
    const t = ticket([step("s1", BOB, "pending"), step("s2", ALICE, "pending", ["s1"])]);
    // bob's step is up; alice's waits on it; carol spoke without being asked
    expect(peopleLabel(summarize(t, [msg(CAROL, { ticketId: "t1" })], ALICE), nameFor)).toBe("bob ▸  you ·  carol …");
    expect(peopleLabel(summarize(ticket([step("s1", BOB, "settled")]), [], ALICE), nameFor)).toBe("bob ✓");
  });

  it("a review asking for changes is not a tick and not a failure: ↻", () => {
    const asked = { ...ticket([step("s1", BOB, "failed")]), kind: "review" as const };
    const reviewStep = { ...asked, steps: [{ ...asked.steps[0]!, intent: "review" }] };
    expect(peopleLabel(summarize(reviewStep, [], ALICE), nameFor)).toBe("bob ↻");
    // the same failed status on a task step is a failure, and says so
    expect(peopleLabel(summarize(ticket([step("s1", BOB, "failed")]), [], ALICE), nameFor)).toBe("bob ✕");
  });

  it("orders needs-you, waiting, failed, done; newest activity first within a state", () => {
    const a = summarize(ticket([step("s1", ALICE, "pending")], 10), [], ALICE);
    const b = summarize(ticket([step("s1", BOB, "pending")], 50), [], ALICE);
    const c = summarize(ticket([step("s1", BOB, "pending")], 90), [], ALICE);
    const d = summarize(ticket([step("s1", BOB, "settled")], 99), [], ALICE);
    expect([d, b, a, c].sort(compareSummaries).map((s) => s.lastActivity)).toEqual([10, 90, 50, 99]);
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
    const t: Ticket = { ...ticket([step("address", ALICE, "pending")]), kind: "review" };
    expect(summarize(t, [], ALICE).state).toBe("needs-you");
    expect(summarize(t, [], BOB).state).toBe("waiting");
  });

  it("a reader's posted review does not finish it — the author's step does", () => {
    const read: Ticket = { ...ticket([step("review-bob", BOB, "settled"), step("address", ALICE, "pending")]), kind: "review" };
    expect(summarize(read, [], ALICE).state).toBe("needs-you");
    expect(summarize(read, [], ALICE).settledBy.has(BOB)).toBe(true);
    const acted: Ticket = { ...ticket([step("review-bob", BOB, "settled"), step("address", ALICE, "settled")]), kind: "review" };
    expect(summarize(acted, [], ALICE).state).toBe("done");
  });

  it("a ticket with no steps at all is not done", () => {
    expect(summarize(ticket([]), [], ALICE).state).toBe("waiting");
  });
});
