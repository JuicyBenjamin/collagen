import { describe, expect, it } from "vitest";
import { githubRepo, pickPull, pullNumberIn, readComments, readPull, readUser, refusal } from "./github";

const pull = (over: Record<string, unknown> = {}) => ({
  number: 7,
  url: "https://github.com/acme/shop/pull/7",
  title: "Stream the export",
  state: "OPEN",
  isDraft: false,
  author: { login: "alice" },
  headRefOid: "abc123",
  headRefName: "feat/stream",
  baseRefName: "main",
  reviewDecision: "REVIEW_REQUIRED",
  ...over,
});

describe("what gh answers, read for the review page", () => {
  it("a link's repository and the pull request it names", () => {
    expect(githubRepo("https://github.com/acme/shop.git")).toEqual({ owner: "acme", repo: "shop" });
    expect(pullNumberIn("https://github.com/acme/shop/pull/12/files")).toBe(12);
    expect(pullNumberIn("https://github.com/acme/shop/tree/feat/x")).toBeNull();
    expect(githubRepo("https://gitlab.com/acme/shop")).toBeNull();
  });

  it("who is signed in", () => {
    expect(readUser({ login: "bob", name: "Bob", avatar_url: "https://avatars/u/1" })).toEqual({ login: "bob", name: "Bob", avatarUrl: "https://avatars/u/1" });
    expect(readUser({ login: "bob", name: null })).toEqual({ login: "bob" });
    expect(readUser({ message: "Bad credentials" })).toBeNull();
  });

  it("a pull request: its state and decision in words, and whether the reader opened it", () => {
    expect(readPull(pull(), "bob")).toMatchObject({ number: 7, state: "open", decision: "review required", mine: false, branch: "feat/stream", base: "main" });
    expect(readPull(pull({ state: "MERGED", reviewDecision: "" }), "alice")).toMatchObject({ state: "merged", mine: true });
    expect(readPull(pull({ reviewDecision: "" }), "alice")?.decision).toBeUndefined();
    expect(readPull({ number: 7 }, "bob")).toBeNull();
  });

  it("the branch's pull request: the open one, else the latest", () => {
    expect(pickPull([{ state: "merged", n: 1 }, { state: "open", n: 2 }])?.n).toBe(2);
    expect(pickPull([{ state: "closed", n: 3 }, { state: "merged", n: 1 }])?.n).toBe(3);
    expect(pickPull([])).toBeNull();
  });

  it("line comments across pages; an outdated one, on no line now, left out", () => {
    const c = (id: number, line: number | null, side = "RIGHT") => ({ id, body: "why?", path: "src/a.ts", line, side, user: { login: "bob", avatar_url: "u" }, html_url: `h${id}`, created_at: "2026-10-03T10:00:00Z" });
    const read = readComments([[c(1, 4), c(2, null)], [c(3, 9, "LEFT")]]);
    expect(read.map((x) => [x.id, x.line, x.side])).toEqual([
      [1, 4, "RIGHT"],
      [3, 9, "LEFT"],
    ]);
    expect(readComments({ message: "Not Found" })).toEqual([]);
    // a block of lines says where it starts; one line does not
    const block = readComments([[{ ...c(4, 7), start_line: 5, start_side: "RIGHT" }, { ...c(5, 7), start_line: null, start_side: null }]]);
    expect(block.map((x) => [x.startLine, x.startSide, x.line])).toEqual([
      [5, "RIGHT", 7],
      [undefined, undefined, 7],
    ]);
  });

  it("gh's refusal, in its own words", () => {
    expect(refusal("failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)\n")).toBe("GraphQL: Can not approve your own pull request (addPullRequestReview)");
    expect(refusal("gh: Validation Failed (HTTP 422)\n")).toBe("Validation Failed");
    expect(refusal("")).toBe("GitHub refused it");
  });
});
