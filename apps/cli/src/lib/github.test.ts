import { describe, expect, it } from "vitest";
import { githubRepo, landedAs, latestMerges, type MergedPull, pickPull, pullNumberIn, readComments, readConversation, readOutdated, readPull, readReviews, readUser, refusal } from "./github";

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
    expect(readPull(pull({ state: "MERGED", reviewDecision: "", mergeCommit: { oid: "abc" } }), "alice")).toMatchObject({ state: "merged", mine: true, merged: "abc" });
    expect(readPull(pull({ mergeCommit: null }), "bob")?.merged).toBeUndefined();
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
      ["1", 4, "RIGHT"],
      ["3", 9, "LEFT"],
    ]);
    expect(readComments({ message: "Not Found" })).toEqual([]);
    // a block of lines says where it starts; one line does not
    const block = readComments([[{ ...c(4, 7), start_line: 5, start_side: "RIGHT" }, { ...c(5, 7), start_line: null, start_side: null }]]);
    expect(block.map((x) => [x.startLine, x.startSide, x.line])).toEqual([
      [5, "RIGHT", 7],
      [undefined, undefined, 7],
    ]);
  });

  it("a reply knows the comment it answers; a comment on changed code reads as where it was", () => {
    const c = { id: 8, body: "agreed", path: "src/a.ts", line: 4, side: "RIGHT", in_reply_to_id: 7, user: { login: "bob" }, html_url: "h8", created_at: "t" };
    expect(readComments([[c]])[0]?.replyTo).toBe("7");
    const old = { ...c, id: 9, line: null, original_line: 12, in_reply_to_id: undefined };
    expect(readOutdated([[c, old]])).toEqual([{ id: "9", author: { login: "bob" }, body: "agreed", at: "t", url: "h8", outdated: "src/a.ts, line 12" }]);
  });

  it("the reviews: each verdict in words; a pending one, and a bare comment-only one, left out", () => {
    const r = (id: number, state: string, body: string) => ({ id, state, body, user: { login: "carol" }, submitted_at: `2026-10-0${id}T00:00:00Z`, html_url: `r${id}` });
    expect(readReviews([[r(1, "APPROVED", ""), r(2, "CHANGES_REQUESTED", "Rename it."), r(3, "COMMENTED", ""), r(4, "PENDING", "draft"), r(5, "COMMENTED", "Nice.")]]).map((x) => [x.id, x.verdict, x.body])).toEqual([
      ["1", "approved", ""],
      ["2", "changes requested", "Rename it."],
      ["5", "commented", "Nice."],
    ]);
  });

  it("the conversation, comment by comment", () => {
    expect(readConversation([[{ id: 3, body: "Ship Friday?", user: { login: "carol" }, created_at: "t", html_url: "c3" }]])).toEqual([{ id: "3", author: { login: "carol" }, body: "Ship Friday?", at: "t", url: "c3" }]);
  });

  it("how a pull request landed, read from the commit it landed as", () => {
    const head = { oid: "h", messageHeadline: "feat: stream it", authoredDate: "2026-10-01T09:00:00Z" };
    const landed = (mergeCommit: MergedPull["mergeCommit"]) =>
      landedAs({ number: 1, title: "", url: "", headRefName: "b", mergedAt: "", updatedAt: "", mergeCommit, commits: { totalCount: 3, nodes: [{ commit: head }] } })?.kind;
    expect(landed({ oid: "m", messageHeadline: "Merge pull request #1", authoredDate: "2026-10-02T00:00:00Z", parents: { totalCount: 2 } })).toBe("merge");
    expect(landed({ ...head, parents: { totalCount: 1 } })).toBe("fast-forward");
    expect(landed({ ...head, oid: "r", parents: { totalCount: 1 } })).toBe("rebase");
    expect(landed({ oid: "s", messageHeadline: "PR 1 (#1)", authoredDate: "2026-10-02T00:00:00Z", parents: { totalCount: 1 } })).toBe("squash");
    // its merge commit gone, history rewritten since: nothing on the branch to point at
    expect(landed(null)).toBe(undefined);
  });

  it("the latest merges are certain once a page changed before the last one wanted merged", () => {
    const merge = (number: number, at: string) => ({ number, url: `u${number}`, title: "", branch: `b${number}`, kind: "squash" as const, commit: `c${number}`, commits: 1, at });
    // an old pull request commented on today comes first; a newer merge, untouched since, on the next page
    const first = { merges: [merge(1, "2026-01-01"), merge(2, "2026-10-01")], oldestUpdate: "2026-10-05", next: "p2" };
    expect(latestMerges([first], 2)).toEqual({ merges: [merge(2, "2026-10-01"), merge(1, "2026-01-01")], done: false, more: true });
    const second = { merges: [merge(3, "2026-09-01"), merge(2, "2026-10-01")], oldestUpdate: "2026-09-01", next: "p3" };
    expect(latestMerges([first, second], 2)).toEqual({ merges: [merge(2, "2026-10-01"), merge(3, "2026-09-01")], done: true, more: true });
    // the last page read, and every merge on it shown: nothing past them
    expect(latestMerges([{ ...first, next: null }], 5)).toMatchObject({ done: true, more: false });
  });

  it("gh's refusal, in its own words", () => {
    expect(refusal("failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)\n")).toBe("GraphQL: Can not approve your own pull request (addPullRequestReview)");
    expect(refusal("gh: Validation Failed (HTTP 422)\n")).toBe("Validation Failed");
    expect(refusal("")).toBe("GitHub refused it");
  });
});
