import type { Stack, StackStep } from "@collagen/review-web/data";

// The stack a branch sits in: each branch built on another's head, down to
// the trunk, and what is built on it in turn. Pure — the edges come from the
// host's open pull requests (a pull request joins its head to its base) and
// from the room's own reviews (a review names its branch and base), the
// pull request winning where both name the same branch.

/** One branch built on another: a pull request or a review. */
export interface Edge extends StackStep {
  readonly base: string;
}

/** The stack `branch` sits in, or null when it builds on the trunk alone
 *  and nothing builds on it. Below: from the trunk up. Above: the chain on
 *  top of it while there is one way up. Split: where several branches build
 *  on the top of that chain, each of them — the climb stops there. */
export const stackOf = (branch: string, base: string | undefined, edges: ReadonlyArray<Edge>): Stack | null => {
  const byHead = new Map<string, Edge>();
  for (const e of edges) {
    const had = byHead.get(e.branch);
    if (!had || (had.kind !== "pull" && e.kind === "pull")) byHead.set(e.branch, e);
  }
  const step = ({ base: _base, ...s }: Edge): StackStep => s;
  const self = byHead.get(branch);
  const seen = new Set([branch]);

  const below: Array<StackStep> = [];
  let down = self?.base ?? base;
  // a cycle (two pull requests on each other) stops the walk where it repeats
  let looped = false;
  while (down !== undefined) {
    if (seen.has(down)) {
      looped = true;
      break;
    }
    seen.add(down);
    const e = byHead.get(down);
    if (!e) break;
    below.unshift(step(e));
    down = e.base;
  }

  const above: Array<StackStep> = [];
  let split: ReadonlyArray<StackStep> = [];
  let up = branch;
  for (;;) {
    const on = [...byHead.values()].filter((e) => e.base === up && !seen.has(e.branch));
    if (on.length === 0) break;
    for (const e of on) seen.add(e.branch);
    if (on.length > 1) {
      split = on.map(step);
      break;
    }
    above.push(step(on[0]!));
    up = on[0]!.branch;
  }

  if (below.length === 0 && above.length === 0 && split.length === 0) return null;
  // the trunk heads it: what the bottom of the stack is built on
  if (down !== undefined && !looped) below.unshift({ branch: down, label: down, kind: "trunk" });
  return { below, here: self ? step(self) : { branch, label: branch, kind: "review" }, above, split };
};
