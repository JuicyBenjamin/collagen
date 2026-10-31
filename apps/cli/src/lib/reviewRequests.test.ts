import { describe, expect, it } from "vitest";
import { workConversations, type Found } from "./reviewRequests";

const REPO = "/work/shop";
const found = (id: string, over: Partial<Found> = {}): Found => ({
  conversation: { ai: "claude-code", id },
  cwd: REPO,
  branches: [],
  startedAt: 1,
  endedAt: 2,
  named: 0,
  files: 0,
  ...over,
});
const ids = (picked: ReadonlyArray<Found>) => picked.map((one) => one.conversation.id);

describe("which conversations a review asked of someone's work is read from", () => {
  it("the one whose entries ran on the branch, not one on another branch or in another repo", () => {
    const picked = workConversations(
      [found("on-branch", { branches: ["feat/pay"] }), found("other-branch", { branches: ["feat/ship"] }), found("other-repo", { cwd: "/work/blog", branches: ["feat/pay"] })],
      "feat/pay",
      [REPO],
    );
    expect(ids(picked)).toEqual(["on-branch"]);
  });

  it("in a GitButler workspace every session runs on one branch: the one that names the branch and its files is the work", () => {
    const picked = workConversations(
      [found("did-it", { branches: ["gitbutler/workspace"], named: 4, files: 3 }), found("idle", { branches: ["gitbutler/workspace"] })],
      "feat/pay",
      [REPO],
    );
    expect(ids(picked)).toEqual(["did-it"]);
  });

  it("a conversation in one of the project's worktrees counts as the project's", () => {
    const picked = workConversations([found("in-worktree", { cwd: "/work/.worktrees/shop/pay/apps/api", branches: ["feat/pay"] })], "feat/pay", [REPO, "/work/.worktrees/shop/pay"]);
    expect(ids(picked)).toEqual(["in-worktree"]);
  });

  it("a folder that only starts with the project's name is not the project", () => {
    expect(workConversations([found("lookalike", { cwd: "/work/shopfront", branches: ["feat/pay"] })], "feat/pay", [REPO])).toEqual([]);
  });

  it("the top of an orchestration is read, not the conversations it started", () => {
    const picked = workConversations(
      [found("orchestrator", { branches: ["feat/pay"], named: 2 }), found("worker", { branches: ["feat/pay"], named: 9, files: 12, parent: "orchestrator" })],
      "feat/pay",
      [REPO],
    );
    expect(ids(picked)).toEqual(["orchestrator"]);
  });

  it("a child whose parent did not work on the branch is read on its own", () => {
    const picked = workConversations([found("worker", { branches: ["feat/pay"], parent: "elsewhere" })], "feat/pay", [REPO]);
    expect(ids(picked)).toEqual(["worker"]);
  });

  it("several conversations about as tied to the work are read together, the most tied first, three at most", () => {
    const picked = workConversations(
      [
        found("half", { branches: ["feat/pay"], startedAt: 5 }),
        found("most", { branches: ["feat/pay"], named: 5, startedAt: 9 }),
        found("also", { branches: ["feat/pay"], named: 1, startedAt: 3 }),
        found("fourth", { branches: ["feat/pay"], startedAt: 7 }),
        found("barely", { named: 1, startedAt: 1 }),
      ],
      "feat/pay",
      [REPO],
    );
    expect(ids(picked)).toEqual(["most", "also", "half"]);
  });

  it("collagen's own jobs are never taken for the person's work", () => {
    const picked = workConversations([found("job", { branches: ["feat/pay"], named: 8 }), found("person", { branches: ["feat/pay"] })], "feat/pay", [REPO], new Set(["claude-code:job"]));
    expect(ids(picked)).toEqual(["person"]);
  });
});
