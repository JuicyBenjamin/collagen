import { describe, expect, it } from "vitest";
import { machineProblems } from "@collagen/p2p";
import { nextQuestion, questionMachine, QUESTION_MOVES, type QuestionState } from "./questionMachine";

const ALL: ReadonlyArray<QuestionState> = ["new", "waiting", "asking", "answering", "answered", "declined", "addressing"];

describe("a question's life", () => {
  it("draws as a machine the review page can play", () => {
    expect(machineProblems(questionMachine())).toEqual([]);
  });

  it("reaches every state from where a question arrives", () => {
    const reached = new Set<QuestionState>(["new"]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const move of QUESTION_MOVES)
        if (move.from.some((from) => reached.has(from)) && !reached.has(move.to)) {
          reached.add(move.to);
          grew = true;
        }
    }
    expect([...reached].sort()).toEqual([...ALL].sort());
  });

  it("ends where it ends: an answered, declined or fixed question takes no further move", () => {
    for (const done of ["answered", "declined", "addressing"] as const) for (const move of QUESTION_MOVES) expect(move.from).not.toContain(done);
    expect(nextQuestion("answered", "yes")).toBeNull();
    expect(nextQuestion("declined", "answered")).toBeNull();
  });

  it("takes only the moves the table has: a yes before it arrived, or a job ending that never ran, is refused", () => {
    expect(nextQuestion("new", "yes")).toBeNull();
    expect(nextQuestion("waiting", "ended")).toBeNull();
    expect(nextQuestion("asking", "yes")).toBe("answering");
    expect(nextQuestion("answering", "fixing")).toBe("addressing");
  });
});
