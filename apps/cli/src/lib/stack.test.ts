import { describe, expect, it } from "vitest";
import { stackOf, stackPlace, type Edge } from "./stack";

const pull = (branch: string, base: string, number: number): Edge => ({ branch, base, label: `PR ${branch}`, number: number, url: `https://github.com/o/r/pull/${number}`, kind: "pull" });
const review = (branch: string, base: string): Edge => ({ branch, base, label: `review ${branch}`, url: `/review/${branch}`, kind: "review" });
const line = (stack: ReturnType<typeof stackOf>) =>
  stack ? [...stack.below.map((step) => step.branch), `[${stack.here.branch}]`, ...stack.above.map((step) => step.branch), ...(stack.split.length > 0 ? [`{${stack.split.map((step) => step.branch).join(" | ")}}`] : [])].join(" ‹ ") : null;

describe("the stack a branch sits in", () => {
  it("what it builds on, down to the trunk, and what builds on it", () => {
    const edges = [pull("a", "main", 1), pull("b", "a", 2), pull("c", "b", 3), pull("d", "c", 4)];
    expect(line(stackOf("b", "a", edges))).toBe("main ‹ a ‹ [b] ‹ c ‹ d");
    expect(stackOf("b", "a", edges)?.below[0]).toEqual({ branch: "main", label: "main", kind: "trunk" });
  });

  it("says where a branch is from the bottom, of how many: the trunk is not one, a split is one more", () => {
    const edges = [pull("a", "main", 1), pull("b", "a", 2), pull("c", "b", 3), pull("d", "c", 4)];
    expect(stackPlace(stackOf("b", "a", edges)!)).toEqual({ at: 2, of: 4 });
    expect(stackPlace(stackOf("a", "main", [pull("a", "main", 1), pull("b1", "a", 2), pull("b2", "a", 3)])!)).toEqual({ at: 1, of: 2 });
  });

  it("on the trunk with nothing above: no stack", () => {
    expect(stackOf("a", "main", [pull("a", "main", 1), pull("x", "main", 9)])).toBeNull();
  });

  it("on the trunk with something above: the trunk still heads it", () => {
    expect(line(stackOf("a", "main", [pull("a", "main", 1), pull("b", "a", 2)]))).toBe("main ‹ [a] ‹ b");
  });

  it("several branches on one: each listed as a split, and the climb stops there", () => {
    const edges = [pull("a", "main", 1), pull("b1", "a", 2), pull("b2", "a", 3), pull("c", "b1", 4)];
    expect(line(stackOf("a", "main", edges))).toBe("main ‹ [a] ‹ {b1 | b2}");
    expect(line(stackOf("x", "main", [pull("x", "main", 1), pull("y", "x", 2), pull("z1", "y", 3), pull("z2", "y", 4)]))).toBe("main ‹ [x] ‹ y ‹ {z1 | z2}");
  });

  it("a review in the room fills in where there is no pull request; a pull request wins where both are", () => {
    const edges = [review("a", "main"), pull("b", "a", 2), review("b", "a"), review("c", "b")];
    const stack = stackOf("b", "a", edges)!;
    expect(line(stack)).toBe("main ‹ a ‹ [b] ‹ c");
    expect([stack.below[1]!.kind, stack.here.kind, stack.above[0]!.kind]).toEqual(["review", "pull", "review"]);
  });

  it("a branch with no record of its own still sits on the base it names", () => {
    expect(line(stackOf("b", "a", [pull("a", "main", 1)]))).toBe("main ‹ a ‹ [b]");
  });

  it("a cycle stops the walk instead of looping", () => {
    expect(line(stackOf("a", "b", [pull("a", "b", 1), pull("b", "a", 2)]))).toBe("b ‹ [a]");
  });
});
