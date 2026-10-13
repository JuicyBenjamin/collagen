import { describe, expect, it } from "vitest";
import { githubRepo, landedAs, latestMerges, type MergedPull, pickPull, type Pull, type PullComment, pullNumberIn, refusal, type Review, splitComments, toPull, toReview } from "./github";

const pull: Pull = {
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
  isCrossRepository: false,
  mergeCommit: null,
};

const comment = (id: number, over: Partial<PullComment> = {}): PullComment => ({ id, user: { login: "bob" }, body: "why?", path: "src/a.ts", line: 4, html_url: `h${id}`, created_at: "t", ...over });

const review = (id: number, state: Review["state"], body: string): Review => ({ id, state, body, user: { login: "carol" }, submitted_at: "t", html_url: `r${id}` });

describe("what gh answers, read for the review page", () => {
  it("a link's repository and the pull request it names", () => {
    expect(githubRepo("https://github.com/acme/shop.git")).toEqual({ owner: "acme", repo: "shop" });
    expect(pullNumberIn("https://github.com/acme/shop/pull/12/files")).toBe(12);
    expect(pullNumberIn("https://github.com/acme/shop/tree/feat/x")).toBeNull();
    expect(githubRepo("https://gitlab.com/acme/shop")).toBeNull();
  });

  it("a pull request: its state and decision in words, the commit it merged as, a fork's head", () => {
    expect(toPull(pull)).toMatchObject({ number: 7, state: "open", decision: "review required", author: "alice", branch: "feat/stream", base: "main" });
    expect(toPull({ ...pull, state: "MERGED", reviewDecision: "", mergeCommit: { oid: "abc" } })).toMatchObject({ state: "merged", merged: "abc" });
    expect(toPull({ ...pull, reviewDecision: "" }).decision).toBeUndefined();
    // a commit named while open is not what it merged as
    expect(toPull({ ...pull, mergeCommit: { oid: "abc" } }).merged).toBeUndefined();
    expect(toPull({ ...pull, isCrossRepository: true }).fork).toBe(true);
  });

  it("the branch's pull request: the open one, else the latest", () => {
    expect(pickPull([{ state: "merged", n: 1 }, { state: "open", n: 2 }])?.n).toBe(2);
    expect(pickPull([{ state: "closed", n: 3 }, { state: "merged", n: 1 }])?.n).toBe(3);
    expect(pickPull([])).toBeNull();
  });

  it("line comments: on their line now, or on changed code, read as where they were", () => {
    const { inline, outdated } = splitComments([comment(1), comment(2, { line: null, original_line: 12 }), comment(3, { line: 9, side: "LEFT" })]);
    expect(inline.map((x) => [x.id, x.line, x.side])).toEqual([
      ["1", 4, "RIGHT"],
      ["3", 9, "LEFT"],
    ]);
    expect(outdated).toEqual([{ id: "2", author: { login: "bob" }, body: "why?", at: "t", url: "h2", outdated: "src/a.ts, line 12" }]);
  });

  it("a block of lines says where it starts, one line does not; a reply knows what it answers", () => {
    const { inline } = splitComments([comment(4, { line: 7, start_line: 5, start_side: "RIGHT" }), comment(5, { line: 7, start_line: null, start_side: null }), comment(6, { in_reply_to_id: 4 })]);
    expect(inline.map((x) => [x.startLine, x.startSide, x.line, x.replyTo])).toEqual([
      [5, "RIGHT", 7, undefined],
      [undefined, undefined, 7, undefined],
      [undefined, undefined, 4, "4"],
    ]);
  });

  it("the reviews: each verdict in words; a pending one, and a bare comment-only one, left out", () => {
    const reviews = [review(1, "APPROVED", ""), review(2, "CHANGES_REQUESTED", "Rename it."), review(3, "COMMENTED", " "), review(4, "PENDING", "draft"), review(5, "COMMENTED", "Nice.")];
    expect(reviews.flatMap((r) => toReview(r) ?? []).map((x) => [x.id, x.verdict, x.body])).toEqual([
      ["1", "approved", ""],
      ["2", "changes requested", "Rename it."],
      ["5", "commented", "Nice."],
    ]);
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
    expect(latestMerges([first], 2)).toEqual({ merges: [merge(2, "2026-10-01"), merge(1, "2026-01-01")], done: false });
    const second = { merges: [merge(3, "2026-09-01"), merge(2, "2026-10-01")], oldestUpdate: "2026-09-01", next: "p3" };
    expect(latestMerges([first, second], 2)).toEqual({ merges: [merge(2, "2026-10-01"), merge(3, "2026-09-01")], done: true });
    expect(latestMerges([{ ...first, next: null }], 5).done).toBe(true);
  });

  it("gh's refusal, in its own words", () => {
    expect(refusal("failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)\n")).toBe("GraphQL: Can not approve your own pull request (addPullRequestReview)");
    expect(refusal("gh: Validation Failed (HTTP 422)\n")).toBe("Validation Failed");
    expect(refusal("")).toBe("GitHub refused it");
  });
});
