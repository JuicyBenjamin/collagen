import { describe, expect, it } from "vitest";
import { machineProblems } from "@collagen/p2p";
import { askMachine, ASK_MOVES, nextAsk, type AskState } from "./askMachine";

const ALL: ReadonlyArray<AskState> = ["new", "waiting", "asking", "filing", "filed", "declined", "unsure"];

describe("a review ask's life", () => {
  it("draws as a machine the review page can play", () => {
    expect(machineProblems(askMachine())).toEqual([]);
  });

  it("reaches every state from where an ask arrives", () => {
    const reached = new Set<AskState>(["new"]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const move of ASK_MOVES)
        if (move.from.some((from) => reached.has(from)) && !reached.has(move.to)) {
          reached.add(move.to);
          grew = true;
        }
    }
    expect([...reached].sort()).toEqual([...ALL].sort());
  });

  it("never stays where it arrived when filing cannot start: it waits on the author", () => {
    expect(nextAsk("new", "unreadable")).toBe("waiting");
  });

  it("ends where it ends: a filed or declined ask takes no further move", () => {
    for (const done of ["filed", "declined"] as const) for (const move of ASK_MOVES) expect(move.from).not.toContain(done);
    expect(nextAsk("filed", "yes")).toBeNull();
    expect(nextAsk("declined", "filed")).toBeNull();
  });

  it("takes only the moves the table has: unsure only from filing, a yes again after unsure", () => {
    expect(nextAsk("waiting", "unsure")).toBeNull();
    expect(nextAsk("filing", "unsure")).toBe("unsure");
    expect(nextAsk("unsure", "yes")).toBe("filing");
  });
});
