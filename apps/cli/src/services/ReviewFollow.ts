import { Effect } from "effect";
import type { ReviewContext } from "@collagen/p2p";
import type { Hunk, Outdated } from "@collagen/review-web/data";
import { placeComment, type Spot } from "../lib/comments";
import { changesOf, findMoved, followBlock } from "../lib/follow";
import { firstRef, run } from "../lib/gitRun";
import { reviewHunks, showAt } from "./ReviewView";

// A comment stays with the code it was written on. Each comment remembers the
// commit its lines are of; when the branch has moved since, its lines are
// followed to the branch's commit now (lib/follow), its file through a
// rename. One whose lines were changed, taken out, or left the change is
// OUTDATED: it sits on its file, never on other code, with where it was and
// those lines as they were. Read every time comments are shown or said —
// nothing is rewritten in the record, so a comment said in the room by
// someone else follows the same way.

/** A comment where it stands now: its spot at `commit`, the branch's now, and why it is outdated if it is. */
export interface Followed {
  readonly spot: Spot;
  readonly commit: string;
  readonly outdated?: Outdated;
}

/** What following needs of a review: its branch, and the clone that holds it. */
interface Reviewed {
  readonly ticket: { readonly id: string };
  readonly review: ReviewContext;
  readonly project: { readonly path: string } | undefined;
}

/** A place on the diff as GitHub names it: +12 on the new side, −12 on the old. */
const named = (side: "LEFT" | "RIGHT", line: number) => `${side === "LEFT" ? "−" : "+"}${line}`;
/** Where a comment was, in words, as the page says it. */
const wasOf = (spot: Spot) =>
  spot.subject === "file"
    ? "the file"
    : spot.startLine !== undefined
      ? `lines ${named(spot.startSide ?? spot.side, spot.startLine)} to ${named(spot.side, spot.line)}`
      : `line ${named(spot.side, spot.line)}`;

/** The most of its lines an outdated comment quotes. */
const QUOTED = 8;

// git's answers, kept: a pair of commits never changes what lies between them
const KEPT = 500;
const remember = <V>(kept: Map<string, V>, key: string, value: V) => {
  if (kept.size >= KEPT) kept.delete(kept.keys().next().value!);
  kept.set(key, value);
};
const renames = new Map<string, ReadonlyMap<string, string | null>>();
const fileDiffs = new Map<string, string | null>();
const diffs = new Map<string, { readonly hunks: ReadonlyArray<Hunk>; readonly commit: string }>();

/** Each file a commit pair moved or deleted: its path at `to`, or null when it is gone. */
const movedFiles = (path: string, from: string, to: string) =>
  Effect.gen(function* () {
    const key = `${path}\0${from}\0${to}`;
    const known = renames.get(key);
    if (known) return known;
    const listed = (yield* run("git", ["diff", "-M", "--name-status", "--no-color", from, to], path, 15_000)) ?? "";
    const moved = new Map<string, string | null>();
    for (const row of listed.split("\n")) {
      const [status, first, second] = row.split("\t");
      if (status?.startsWith("R") && first && second) moved.set(first, second);
      else if (status === "D" && first) moved.set(first, null);
    }
    remember(renames, key, moved);
    return moved as ReadonlyMap<string, string | null>;
  });

/** One file's changes between two commits, line for line (`-U0`), through a rename. */
const fileDiff = (path: string, from: string, to: string, was: string, now: string) =>
  Effect.gen(function* () {
    const key = `${path}\0${from}\0${to}\0${was}\0${now}`;
    if (fileDiffs.has(key)) return fileDiffs.get(key)!;
    const diff = yield* run("git", ["diff", "-U0", "-M", "--no-color", "--no-ext-diff", from, to, "--", ...new Set([was, now])], path, 15_000);
    remember(fileDiffs, key, diff);
    return diff;
  });

/** The review's diff at the branch's commit now, read once per commit. */
const diffAt = (found: Reviewed, tip: string | null) =>
  Effect.gen(function* () {
    const key = `${found.ticket.id}\0${tip}`;
    const known = tip === null ? undefined : diffs.get(key);
    if (known) return known;
    const read = yield* reviewHunks(found);
    if ("error" in read) return null;
    if (tip !== null) remember(diffs, key, read);
    return read;
  });

/** Where one comment written at `commit` stands at `head`, the review's diff there being `hunks`. */
const followOne = (path: string, head: string, hunks: ReadonlyArray<Hunk>, commit: string, spot: Spot) =>
  Effect.gen(function* () {
    if (commit === head) return { spot, commit: head } satisfies Followed;
    const outdated = (file: string, why: string, quote: ReadonlyArray<string>): Followed => ({
      spot: { subject: "file", file },
      commit: head,
      outdated: { was: wasOf(spot), why, quote: quote.slice(0, QUOTED) },
    });
    if ((yield* run("git", ["cat-file", "-e", `${commit}^{commit}`], path, 5_000)) === null) return outdated(spot.file, "the commit it was written on is no longer in your clone", []);
    const moved = yield* movedFiles(path, commit, head);
    const file = moved.has(spot.file) ? moved.get(spot.file)! : spot.file;
    if (spot.subject === "file") {
      if (file === null) return outdated(spot.file, "its file was deleted", []);
      const now: Spot = { subject: "file", file };
      return placeComment(hunks, now) === null ? ({ spot: now, commit: head } satisfies Followed) : outdated(file, "its file is no longer part of the change", []);
    }
    const before = (yield* showAt(path, commit, spot.file))?.split("\n") ?? [];
    const from = spot.startLine ?? spot.line;
    const onNew = spot.side === "RIGHT" && (spot.startSide ?? spot.side) === "RIGHT";
    const quote = onNew ? before.slice(from - 1, spot.line) : [];
    if (file === null) return outdated(spot.file, "its file was deleted", quote);
    // a removed line is the base's, which the branch moving leaves as it was: it stays while the change still shows it
    if (!onNew) {
      const kept: Spot = { ...spot, file };
      return placeComment(hunks, kept) === null ? ({ spot: kept, commit: head } satisfies Followed) : outdated(file, "the lines it was on are no longer part of the change", quote);
    }
    let block = followBlock(changesOf((yield* fileDiff(path, commit, head, spot.file, file)) ?? ""), from, spot.line);
    if (!block) block = findMoved(before, (yield* showAt(path, head, file))?.split("\n") ?? [], from, spot.line);
    if (!block) return outdated(file, "the lines it was on changed", quote);
    const now: Spot = { file, side: "RIGHT", line: block.to, ...(spot.startLine !== undefined ? { startLine: block.from, startSide: "RIGHT" as const } : {}) };
    return placeComment(hunks, now) === null ? ({ spot: now, commit: head } satisfies Followed) : outdated(file, "its lines are no longer part of the change", quote);
  });

/** Where each comment stands at the branch's commit now, by id, and that
 *  commit — or, when the clone cannot say (no clone, no branch), nothing:
 *  each stays where it was written. Comments already at the branch's commit
 *  cost one `git rev-parse`. */
export const followComments = Effect.fn("ReviewFollow.follow")(function* (
  found: Reviewed,
  comments: ReadonlyArray<{ readonly id: string; readonly commit: string; readonly spot: Spot }>,
) {
  const followed = new Map<string, Followed>();
  if (comments.length === 0 || !found.project || !found.review.branch) return { head: null, followed };
  const path = found.project.path;
  const ref = yield* firstRef(path, [found.review.branch, `origin/${found.review.branch}`]);
  const tip = ref ? ((yield* run("git", ["rev-parse", `${ref}^{commit}`], path, 5_000))?.trim() ?? null) : null;
  // nothing moved under them: each where it was written
  if (tip !== null && comments.every((comment) => comment.commit === tip)) return { head: tip, followed };
  const diff = yield* diffAt(found, tip);
  if (!diff) return { head: null, followed };
  for (const comment of comments) followed.set(comment.id, yield* followOne(path, diff.commit, diff.hunks, comment.commit, comment.spot));
  return { head: diff.commit, followed };
});
