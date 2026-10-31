import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { emptyReview, mergeReview, ReviewContext } from "./review";
import { goalsOf, mergeTicket, postReview, type Ticket } from "./ticket";

const BOB = { key: "bob", name: "Bob" };

const investigation = (over: Partial<Ticket> = {}): Ticket => ({
  id: "t1",
  project: "collagen",
  goal: "Could collagen use Delta?",
  createdBy: "alice",
  structureAt: 1,
  kind: "investigation",
  steps: [],
  updatedAt: 1,
  ...over,
});

describe("an investigation's goals", () => {
  it("with none listed, its question is the one goal", () => {
    expect(goalsOf({ question: "Could collagen use Delta?" })).toEqual([{ id: "q", ask: "Could collagen use Delta?" }]);
  });

  it("are kept in the order given, corrected by id and withdrawn by id", () => {
    const filed = mergeReview(
      emptyReview("t1", "alice", "Alice"),
      { investigation: { question: "Could collagen use Delta?", goals: [{ ask: "How does Delta store history?", group: "storage" }, { ask: "Does it sync peer to peer?" }, { ask: "What does its merge keep?", group: "storage" }] } },
      1,
    );
    expect(filed.investigation?.goals?.map((goal) => [goal.id, goal.group ?? ""])).toEqual([
      ["g1", "storage"],
      ["g2", ""],
      ["g3", "storage"],
    ]);
    const amended = mergeReview(filed, { investigation: { goals: [{ id: "g2", ask: "Does it sync without a server?", then: [{ if: "it does", ask: "Could our rooms carry it?" }] }, { ask: "What does it cost to run?" }] }, retireGoals: ["g3"] }, 2);
    expect(amended.investigation?.question).toBe("Could collagen use Delta?");
    expect(goalsOf(amended.investigation!)).toEqual([
      { id: "g1", ask: "How does Delta store history?", group: "storage" },
      { id: "g2", ask: "Does it sync without a server?", then: [{ if: "it does", ask: "Could our rooms carry it?" }] },
      { id: "g4", ask: "What does it cost to run?" },
    ]);
    // a withdrawn goal's id is never given out again
    expect(goalsOf(mergeReview(amended, { investigation: { goals: [{ ask: "Who maintains it?" }] } }, 3).investigation!).at(-1)?.id).toBe("g5");
  });

  it("a brief written before goals existed still decodes", () => {
    const older = { ...emptyReview("t1", "alice", "Alice"), investigation: { question: "Could collagen use Delta?" } };
    expect(Schema.decodeUnknownSync(ReviewContext)(older).investigation).toEqual({ question: "Could collagen use Delta?" });
  });
});

describe("a take's answers", () => {
  it("a later take keeps the goals it does not answer, and corrects the ones it does", () => {
    const first = postReview(investigation(), BOB, "Findings: storage", false, 2, undefined, true, [{ goal: "g1", outcome: "answered", findings: "a content-addressed log" }]).ticket;
    const second = postReview(first, BOB, "Findings: sync", false, 3, undefined, true, [
      { goal: "g2", outcome: "not-answerable", findings: "no docs on it" },
      { goal: "g1", outcome: "answered", findings: "a content-addressed log, packed daily", followUps: [{ if: "it packs history", ask: "How big do packs get?", held: true, outcome: "answered", findings: "a few MB a day" }] },
    ]).ticket;
    const take = second.steps.find((step) => step.owner === "bob");
    expect(take?.result).toBe("Findings: sync");
    expect(take?.answers).toEqual([
      { goal: "g2", outcome: "not-answerable", findings: "no docs on it" },
      { goal: "g1", outcome: "answered", findings: "a content-addressed log, packed daily", followUps: [{ if: "it packs history", ask: "How big do packs get?", held: true, outcome: "answered", findings: "a few MB a day" }] },
    ]);
  });

  it("two copies of a take differing only in their answers merge the same either way", () => {
    const base = investigation();
    const one = postReview(base, BOB, "Findings", false, 2, undefined, true, [{ goal: "q", outcome: "answered", findings: "yes" }]).ticket;
    const other = postReview(base, BOB, "Findings", false, 2, undefined, true, [{ goal: "q", outcome: "answered", findings: "no" }]).ticket;
    expect(mergeTicket(one, other)).toEqual(mergeTicket(other, one));
  });
});
