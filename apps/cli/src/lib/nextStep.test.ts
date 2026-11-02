import { describe, expect, it } from "vitest";
import type { Ticket } from "@collagen/p2p";
import { nextLine, nextStepOf } from "./nextStep";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const names: Record<string, string> = { [ALICE]: "you", [BOB]: "bob" };
const nameOf = (key: string) => names[key] ?? key.slice(0, 8);

const step = (id: string, owner: string | undefined, intent: string, status: Ticket["steps"][number]["status"], needs: string[] = []): Ticket["steps"][number] => ({
  id,
  ...(owner ? { owner } : {}),
  intent,
  description: "…",
  needs,
  status,
  updatedAt: 1,
});
const ticket = (steps: Ticket["steps"]): Ticket => ({ id: "t1", project: "sandbox", goal: "fix NaN", createdBy: ALICE, kind: "task", structureAt: 1, updatedAt: 1, steps });
const next = (subject: Ticket, awaiting: ReadonlyArray<{ who: string; what: string }> = []) => {
  const found = nextStepOf(subject, new Map([[subject.id, subject]]), [], awaiting, nameOf);
  return found ? nextLine(found) : null;
};

describe("what a ticket waits on next", () => {
  it("is the owner of the step up now, and what the step is", () => {
    expect(next(ticket([step("s1", BOB, "review", "pending"), step("s2", ALICE, "address", "pending", ["s1"])]))).toBe("Awaiting bob: a review");
    expect(next(ticket([step("s1", BOB, "review", "settled"), step("s2", ALICE, "address", "pending", ["s1"])]))).toBe("Awaiting you: acting on the review");
  });

  it("is someone's hands before any step, when an ask on it waits on them", () => {
    expect(next(ticket([step("s1", BOB, "review", "pending")]), [{ who: "alice", what: "a question about it" }])).toBe("Awaiting alice: manual action — a question about it");
  });

  it("is anyone, for a step nobody has taken", () => {
    expect(next(ticket([step("s1", undefined, "take", "pending")]))).toBe("Awaiting anyone: a take — nobody has taken it yet");
  });

  it("is anyone in the room, for an open review nobody has read yet", () => {
    expect(next({ ...ticket([step("address", ALICE, "address", "pending")]), kind: "review" })).toBe("Awaiting anyone in the room: a review");
  });

  it("is its author closing it, once every step is answered", () => {
    expect(next(ticket([step("s1", BOB, "do", "settled")]))).toBe("Awaiting you: closing it");
  });
});
