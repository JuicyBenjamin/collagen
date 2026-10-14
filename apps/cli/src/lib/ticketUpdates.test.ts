import { describe, expect, it } from "vitest";
import { deriveThreadId, stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
import { isParticipant, myThreadFor, stepChanges, stepUpdateText } from "./ticketUpdates";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const DAVE = "d".repeat(64);

const ticket: Ticket = {
  id: "t1",
  project: "sandbox",
  goal: "fix NaN",
  createdBy: ALICE,
  structureAt: 1,
  kind: "task",
  updatedAt: 1,
  steps: [
    { id: "s1", owner: BOB, intent: "investigate", description: "…", needs: [], status: "pending", updatedAt: 1 },
    { id: "s2", owner: ALICE, intent: "review", description: "…", needs: ["s1"], status: "pending", updatedAt: 1 },
  ],
};
const messageFrom = (from: string, extra: Partial<RoomMessage> = {}): RoomMessage => ({
  id: Math.random().toString(36),
  threadId: deriveThreadId(from, ALICE, "sandbox"),
  from,
  fromName: from.slice(0, 1),
  to: ALICE,
  project: "sandbox",
  intent: "say",
  findings: "…",
  ts: 2,
  ...extra,
});

describe("participants", () => {
  it("creator, owners, and whoever weighed in — nobody else", () => {
    expect(isParticipant(ticket, [], ALICE)).toBe(true);
    expect(isParticipant(ticket, [], BOB)).toBe(true);
    expect(isParticipant(ticket, [], CAROL)).toBe(false);
    expect(isParticipant(ticket, [messageFrom(CAROL, { ticketId: "t1" })], CAROL)).toBe(true);
    expect(isParticipant(ticket, [messageFrom(CAROL)], CAROL)).toBe(false); // about the project, not the ticket
    expect(isParticipant(ticket, [messageFrom(CAROL, { ticketId: "t1" })], DAVE)).toBe(false);
  });
});

describe("myThreadFor — where the update lands", () => {
  it("someone who weighed in: the thread their own message went on", () => {
    const message = messageFrom(CAROL, { ticketId: "t1", threadId: "carol-alice-thread" });
    expect(myThreadFor(ticket, [message], CAROL, BOB)).toBe("carol-alice-thread");
  });
  it("an owner: their step's thread", () => {
    expect(myThreadFor(ticket, [], BOB, ALICE)).toBe(stepThreadId(ticket, ticket.steps[0]!));
  });
  it("the creator: the thread with whoever acted (their step), else the pair thread", () => {
    expect(myThreadFor(ticket, [], ALICE, BOB)).toBe(stepThreadId(ticket, ticket.steps[0]!));
    // alice owns s2 herself, so her own step wins before the actor's — for a creator with no step:
    const oneStepTicket: Ticket = { ...ticket, steps: [ticket.steps[0]!] };
    expect(myThreadFor(oneStepTicket, [], ALICE, BOB)).toBe(stepThreadId(oneStepTicket, oneStepTicket.steps[0]!));
    expect(myThreadFor(oneStepTicket, [], ALICE, CAROL)).toBe(deriveThreadId(ALICE, CAROL, "sandbox"));
  });
});

describe("stepChanges", () => {
  it("reports steps that reached settled or failed, once", () => {
    const before = new Map([["t1", ticket]]);
    const after = new Map([["t1", { ...ticket, steps: [{ ...ticket.steps[0]!, status: "settled" as const, result: "loop bound" }, ticket.steps[1]!] }]]);
    const changes = stepChanges(before, after);
    expect(changes.map((change) => [change.step.id, change.from, change.to])).toEqual([["s1", "pending", "settled"]]);
    expect(stepUpdateText(changes[0]!, "bob")).toBe('bob settled step s1 (investigate) on the ticket "fix NaN" (t1): loop bound');
    expect(stepChanges(after, after)).toEqual([]);
  });
  it("a ticket seen for the first time with settled steps counts (the view caught up)", () => {
    const settled = { ...ticket, steps: [{ ...ticket.steps[0]!, status: "failed" as const, result: "no repo" }, ticket.steps[1]!] };
    expect(stepChanges(new Map(), new Map([["t1", settled]])).map((change) => change.to)).toEqual(["failed"]);
  });
});
