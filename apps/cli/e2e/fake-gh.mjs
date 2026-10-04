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
const out = (v) => (process.stdout.write(JSON.stringify(v)), process.exit(0));
const fail = (msg) => (process.stderr.write(msg + "\n"), process.exit(1));
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fields = (name) => Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === name ? [a.split(/=(.*)/s).slice(0, 2)] : [])));

if (existsSync(join(dir, "signed-out"))) fail("To get started with GitHub CLI, please run:  gh auth login (HTTP 401)");

const PULLS = [
  { number: 6, title: "Rows a page", headRefName: "feat/paging", baseRefName: "main", author: { login: "bob" } },
  { number: 7, title: "Stream the export", headRefName: "feat/stream-export", baseRefName: "feat/paging", author: { login: "alice-gh" } },
  { number: 8, title: "Export to CSV", headRefName: "feat/csv", baseRefName: "feat/stream-export", author: { login: "alice-gh" } },
].map((p) => ({ ...p, url: `https://github.com/acme/sandbox/pull/${p.number}`, state: "OPEN", isDraft: false, headRefOid: "f".repeat(40), reviewDecision: "REVIEW_REQUIRED" }));
const commentsFile = join(dir, "comments.json");
const comments = () => (existsSync(commentsFile) ? JSON.parse(readFileSync(commentsFile, "utf8")) : []);
const commentJson = (c) => ({ ...c, user: { login: "bob", avatar_url: "http://127.0.0.1:9/bob.png" }, html_url: `https://github.com/acme/sandbox/pull/7#discussion_r${c.id}`, created_at: "2026-10-03T10:00:00Z" });

const [a, b] = args;
if (a === "api" && b === "user") out({ login: "bob", name: "Bob Reviewer", avatar_url: "http://127.0.0.1:9/bob.png" });
if (a === "pr" && b === "view") {
  const p = PULLS.find((x) => String(x.number) === args[2]);
  p ? out(p) : fail("GraphQL: Could not resolve to a PullRequest with the number of " + args[2]);
}
if (a === "pr" && b === "list") {
  const head = flag("--head");
  out(head ? PULLS.filter((p) => p.headRefName === head) : PULLS);
}
if (a === "pr" && b === "review") {
  if (args.includes("--approve") && process.env.FAKE_GH_AUTHOR === "bob") fail("failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)");
  out(null);
}
// a whole review: its body comes on stdin (gh api --input -); kept in reviews.log, its comments with the rest
const reviewsFile = join(dir, "reviews.json");
const reviews = () => (existsSync(reviewsFile) ? JSON.parse(readFileSync(reviewsFile, "utf8")) : {});
if (a === "api" && args.includes("POST") && args.some((x) => /pulls\/7\/reviews$/.test(x))) {
  const review = JSON.parse(readFileSync(0, "utf8"));
  appendFileSync(join(dir, "reviews.log"), JSON.stringify(review) + "\n");
  if (review.comments.some((c) => !["src/export.ts", "src/page.ts", "src/use.ts"].includes(c.path))) fail("gh: Unprocessable Entity (HTTP 422)");
  const id = 500 + Object.keys(reviews()).length;
  const made = review.comments.map((c, i) => ({ id: 2000 + id * 10 + i, body: c.body, path: c.path, line: c.line, side: c.side, start_line: c.start_line ?? null, start_side: c.start_side ?? null, commit_id: review.commit_id }));
  writeFileSync(commentsFile, JSON.stringify([...comments(), ...made]));
  writeFileSync(reviewsFile, JSON.stringify({ ...reviews(), [id]: made.map((c) => c.id) }));
  out({ id, state: review.event === "APPROVE" ? "APPROVED" : review.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED", html_url: `https://github.com/acme/sandbox/pull/7#pullrequestreview-${id}` });
}
const ofReview = args.map((x) => x.match(/pulls\/7\/reviews\/(\d+)\/comments$/)).find(Boolean);
if (a === "api" && ofReview) {
  const ids = reviews()[ofReview[1]] ?? [];
  out([comments().filter((c) => ids.includes(c.id)).map(commentJson)]);
}
if (a === "api" && args.includes("POST")) {
  const f = { ...fields("-f"), ...fields("-F") };
  if (!["src/export.ts", "src/page.ts", "src/use.ts"].includes(f.path)) fail("gh: Validation Failed (HTTP 422)");
  const c = { id: 1000 + comments().length, body: f.body, path: f.path, line: Number(f.line), side: f.side, commit_id: f.commit_id, start_line: f.start_line ? Number(f.start_line) : null, start_side: f.start_side ?? null };
  writeFileSync(commentsFile, JSON.stringify([...comments(), c]));
  out(commentJson(c));
}
if (a === "api" && args.some((x) => /pulls\/7\/comments$/.test(x))) {
  const seeded = { id: 900, body: "Why map to strings here?", path: "src/export.ts", line: 2, side: "RIGHT" };
  out([[commentJson(seeded), ...comments().map(commentJson)]]);
}
fail(`fake gh: no answer for ${args.join(" ")}`);
