#!/usr/bin/env node
// A stand-in for the GitHub CLI, so the e2e scenarios never reach GitHub:
// it answers the calls collagen makes like GitHub would, for one repository
// (acme/sandbox) and its pull requests, and writes every call it was asked
// to $FAKE_GH_DIR/calls.log (one JSON array of arguments per line). Comments
// posted are kept in $FAKE_GH_DIR/comments.json. Touch $FAKE_GH_DIR/signed-out
// to play a person who has not signed in.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
appendFileSync(join(dir, "calls.log"), JSON.stringify(args) + "\n");
const out = (value) => (process.stdout.write(JSON.stringify(value)), process.exit(0));
const fail = (message) => (process.stderr.write(message + "\n"), process.exit(1));
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const fields = (name) => Object.fromEntries(args.flatMap((argument, index) => (args[index - 1] === name ? [argument.split(/=(.*)/s).slice(0, 2)] : [])));

if (existsSync(join(dir, "signed-out"))) fail("To get started with GitHub CLI, please run:  gh auth login (HTTP 401)");

const PULLS = [
  { number: 6, title: "Rows a page", headRefName: "feat/paging", baseRefName: "main", author: { login: "bob" } },
  { number: 7, title: "Stream the export", headRefName: "feat/stream-export", baseRefName: "feat/paging", author: { login: "alice-gh" } },
  { number: 8, title: "Export to CSV", headRefName: "feat/csv", baseRefName: "feat/stream-export", author: { login: "alice-gh" } },
].map((pull) => ({ ...pull, url: `https://github.com/acme/sandbox/pull/${pull.number}`, state: "OPEN", isDraft: false, headRefOid: "f".repeat(40), reviewDecision: "REVIEW_REQUIRED" }));
const commentsFile = join(dir, "comments.json");
const comments = () => (existsSync(commentsFile) ? JSON.parse(readFileSync(commentsFile, "utf8")) : []);
const commentJson = (comment) => ({ ...comment, user: { login: "bob", avatar_url: "http://127.0.0.1:9/bob.png" }, html_url: `https://github.com/acme/sandbox/pull/7#discussion_r${comment.id}`, created_at: "2026-10-03T10:00:00Z" });

const [command, subcommand] = args;
// who is signed in: bob, unless a test writes another login to $FAKE_GH_DIR/login
const login = existsSync(join(dir, "login")) ? readFileSync(join(dir, "login"), "utf8").trim() : "bob";
if (command === "api" && subcommand === "user") out({ login, name: login === "bob" ? "Bob Reviewer" : login, avatar_url: `http://127.0.0.1:9/${login}.png` });
// what was merged into main: #6 squashed, #5 by a merge commit, and 120
// older ones squashed — a hundred to a page, as GitHub pages them
// or the pull requests a test wrote to $FAKE_GH_DIR/merges.json, as GitHub has them
if (command === "api" && subcommand === "graphql" && (fields("-f").query ?? "").includes("states: MERGED") && existsSync(join(dir, "merges.json"))) {
  const nodes = fields("-f").base === "main" ? JSON.parse(readFileSync(join(dir, "merges.json"), "utf8")) : [];
  out({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } });
}
if (command === "api" && subcommand === "graphql" && (fields("-f").query ?? "").includes("states: MERGED")) {
  const merged = (number, title, headRefName, mergedAt, oid, parents, last) => ({
    number, title, headRefName, mergedAt, updatedAt: mergedAt, url: `https://github.com/acme/sandbox/pull/${number}`,
    mergeCommit: { oid, messageHeadline: title, authoredDate: mergedAt, parents: { totalCount: parents } },
    commits: { totalCount: 2, nodes: [{ commit: { oid: last, messageHeadline: "wip", authoredDate: "2026-10-01T09:00:00Z" } }] },
  });
  const older = Array.from({ length: 120 }, (_, index) => {
    const at = new Date(Date.parse("2026-09-01T00:00:00Z") - index * 3_600_000).toISOString();
    return merged(1000 + index, `Older change ${index + 1}`, `chore/older-${index + 1}`, at, index.toString(16).padStart(40, "e"), 1, index.toString(16).padStart(40, "f"));
  });
  const all = fields("-f").base === "main"
    ? [merged(6, "Rows a page", "feat/paging", "2026-10-11T10:00:00Z", "a".repeat(40), 1, "b".repeat(40)), merged(5, "Fix the header", "fix/header", "2026-10-09T10:00:00Z", "c".repeat(40), 2, "d".repeat(40)), ...older]
    : [];
  const from = Number(fields("-f").after ?? 0);
  const nodes = all.slice(from, from + 100);
  const next = from + 100 < all.length ? String(from + 100) : null;
  out({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } } });
}
if (command === "pr" && subcommand === "view") {
  const pull = PULLS.find((candidate) => String(candidate.number) === args[2]);
  pull ? out(pull) : fail("GraphQL: Could not resolve to a PullRequest with the number of " + args[2]);
}
if (command === "pr" && subcommand === "list") {
  const head = flag("--head");
  out(head ? PULLS.filter((pull) => pull.headRefName === head) : PULLS);
}
if (command === "pr" && subcommand === "review") {
  if (args.includes("--approve") && process.env.FAKE_GH_AUTHOR === "bob") fail("failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)");
  out(null);
}
// a whole review: its body comes on stdin (gh api --input -); kept in reviews.log, its comments with the rest
const reviewsFile = join(dir, "reviews.json");
const reviews = () => (existsSync(reviewsFile) ? JSON.parse(readFileSync(reviewsFile, "utf8")) : {});
if (command === "api" && args.includes("POST") && args.some((argument) => /pulls\/7\/reviews$/.test(argument))) {
  // GitHub taking its time, while a test does something else meanwhile
  if (existsSync(join(dir, "slow-review"))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  const review = JSON.parse(readFileSync(0, "utf8"));
  appendFileSync(join(dir, "reviews.log"), JSON.stringify(review) + "\n");
  if (review.comments.some((comment) => !["src/export.ts", "src/page.ts", "src/use.ts"].includes(comment.path))) fail("gh: Unprocessable Entity (HTTP 422)");
  const id = 500 + Object.keys(reviews()).length;
  const made = review.comments.map((comment, index) => ({ id: 2000 + id * 10 + index, pull_request_review_id: id, body: comment.body, path: comment.path, line: comment.line, side: comment.side, start_line: comment.start_line ?? null, start_side: comment.start_side ?? null, commit_id: review.commit_id }));
  writeFileSync(commentsFile, JSON.stringify([...comments(), ...made]));
  writeFileSync(reviewsFile, JSON.stringify({ ...reviews(), [id]: { comments: made.map((comment) => comment.id), event: review.event, body: review.body ?? "" } }));
  out({ id, state: review.event === "APPROVE" ? "APPROVED" : review.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED", html_url: `https://github.com/acme/sandbox/pull/7#pullrequestreview-${id}` });
}
const ofReview = args.map((argument) => argument.match(/pulls\/7\/reviews\/(\d+)\/comments$/)).find(Boolean);
if (command === "api" && ofReview) {
  const ids = reviews()[ofReview[1]]?.comments ?? [];
  // as GitHub lists one review's comments: without the lines they are on
  out([comments().filter((comment) => ids.includes(comment.id)).map(({ line: _line, side: _side, start_line: _start, start_side: _startSide, ...comment }) => commentJson(comment))]);
}
const STATE = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", COMMENT: "COMMENTED" };
if (command === "api" && args.some((argument) => /pulls\/7\/reviews$/.test(argument))) {
  const seeded = { id: 98, state: "APPROVED", body: "Good to go.", user: { login: "carol", avatar_url: "http://127.0.0.1:9/carol.png" }, submitted_at: "2026-10-03T09:00:00Z", html_url: "https://github.com/acme/sandbox/pull/7#pullrequestreview-98" };
  const sent = Object.entries(reviews()).map(([id, stored]) => ({ id: Number(id), state: STATE[stored.event], body: stored.body, user: { login: "bob" }, submitted_at: "2026-10-03T11:00:00Z", html_url: `https://github.com/acme/sandbox/pull/7#pullrequestreview-${id}` }));
  out([[seeded, ...sent]]);
}
if (command === "api" && args.some((argument) => /issues\/7\/comments$/.test(argument))) {
  out([[{ id: 77, body: "Can this ship Friday?", user: { login: "carol" }, created_at: "2026-10-03T09:30:00Z", html_url: "https://github.com/acme/sandbox/pull/7#issuecomment-77" }]]);
}
if (command === "api" && args.includes("POST")) {
  const form = { ...fields("-f"), ...fields("-F") };
  if (!["src/export.ts", "src/page.ts", "src/use.ts"].includes(form.path)) fail("gh: Validation Failed (HTTP 422)");
  const comment = { id: 1000 + comments().length, body: form.body, path: form.path, line: Number(form.line), side: form.side, commit_id: form.commit_id, start_line: form.start_line ? Number(form.start_line) : null, start_side: form.start_side ?? null };
  writeFileSync(commentsFile, JSON.stringify([...comments(), comment]));
  out(commentJson(comment));
}
if (command === "api" && args.some((argument) => /pulls\/7\/comments$/.test(argument))) {
  const seeded = { id: 900, body: "Why map to strings here?", path: "src/export.ts", line: 2, side: "RIGHT" };
  const reply = { ...commentJson({ id: 902, body: "Agreed — rows, please.", path: "src/export.ts", line: 2, side: "RIGHT" }), user: { login: "carol" }, in_reply_to_id: 900 };
  const outdated = { ...commentJson({ id: 901, body: "old note", path: "src/export.ts", line: null, side: "RIGHT" }), original_line: 1 };
  out([[commentJson(seeded), reply, outdated, ...comments().map(commentJson)]]);
}
fail(`fake gh: no answer for ${args.join(" ")}`);
