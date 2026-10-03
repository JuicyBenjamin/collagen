import { randomUUID } from "node:crypto";
import { Effect, SubscriptionRef } from "effect";
import type { DraftComment, ReviewComment } from "@collagen/p2p";
import type { AcceptResult, HostWrite, LineComment, TalkView } from "@collagen/review-web/data";
import { placeComment, type Spot } from "../lib/comments";
import { IdentityService } from "./Identity";
import { hostOf, type RepoHost } from "./RepoHost";
import { hostLink, reviewHunks, reviewNamed } from "./ReviewView";
import { StateStore } from "./StateStore";

// Comments on a review's code. The reader's AI DRAFTS them while it reviews:
// kept on this machine only, shown on the review page under the lines they
// are about. The reader accepts (or edits and accepts), or declines, each —
// or tells their AI to post them all. An accepted comment is SAID: on the
// room's log as theirs (a ReviewComment — the author's agent reads it in
// review-context) and, when the review has an open pull request, on it too
// through the reader's own gh — wired here, so neither the page nor the AI
// calls GitHub itself. A comment typed on the page is said the same way.

/** A comment as the agent drafts it: lines of the branch's code as the diff
 *  shows them — a block from startLine to line — on the new side unless it
 *  is about a removed line. */
export interface DraftInput {
  readonly file: string;
  readonly line: number;
  readonly startLine?: number;
  readonly side?: "LEFT" | "RIGHT";
  readonly body: string;
}

const spotOf = (d: { readonly file: string; readonly line: number; readonly side: "LEFT" | "RIGHT"; readonly startLine?: number; readonly startSide?: "LEFT" | "RIGHT" }): Spot => ({
  file: d.file,
  line: d.line,
  side: d.side,
  ...(d.startLine !== undefined ? { startLine: d.startLine, startSide: d.startSide ?? d.side } : {}),
});

/** The drafts waiting on a review, on this machine. */
export const draftsOf = (ticketId: string) => StateStore.use((s) => s.get).pipe(Effect.map((state): ReadonlyArray<DraftComment> => state.drafts?.[ticketId] ?? []));

const setDrafts = (ticketId: string, f: (ds: ReadonlyArray<DraftComment>) => ReadonlyArray<DraftComment>) =>
  StateStore.use((s) =>
    s.update((state) => {
      const next = f(state.drafts?.[ticketId] ?? []);
      const { [ticketId]: _gone, ...rest } = state.drafts ?? {};
      return { ...state, drafts: next.length > 0 ? { ...rest, [ticketId]: [...next] } : rest };
    }),
  );

/** Draft comments on a review's code, each placed on the diff as the reader's
 *  clone has it now (the commit it was read at goes with it): what cannot sit
 *  on a line of the diff is refused, with why, and the rest kept. */
export const draftComments = Effect.fn("ReviewTalk.draft")(function* (ticketId: string, items: ReadonlyArray<DraftInput>) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` };
  if (found.ticket.kind !== "review") return { error: `"${found.ticket.goal}" is a ${found.ticket.kind}: comments go on a review's code` };
  const diff = yield* reviewHunks(found);
  if ("error" in diff) return { error: `cannot read the review's code here: ${diff.error}` };
  const now = Date.now();
  const kept: Array<DraftComment> = [];
  const refused: Array<{ readonly at: string; readonly why: string }> = [];
  items.forEach((item, i) => {
    const side = item.side ?? "RIGHT";
    const spot: Spot = { file: item.file.trim(), line: item.line, side, ...(item.startLine !== undefined && item.startLine !== item.line ? { startLine: item.startLine, startSide: side } : {}) };
    const why = item.body.trim().length === 0 ? "it says nothing" : placeComment(diff.hunks, spot);
    if (why) refused.push({ at: `#${i + 1} (${item.file}:${item.line})`, why });
    else kept.push({ id: randomUUID(), ticketId, ...spot, body: item.body.trim(), commit: diff.commit, ts: now + i });
  });
  if (kept.length > 0) yield* setDrafts(ticketId, (ds) => [...ds, ...kept]);
  return { drafted: kept, refused };
});

/** Where a comment goes besides the room: an open pull request on its host,
 *  or nowhere — and why. */
type Target = { readonly roomOnly: string } | { readonly host: RepoHost; readonly link: string; readonly number: number };

/** The open pull request a comment also goes to, if the review has one and
 *  its host takes comments — or why it is said in the room only. */
const hostFor = (found: NonNullable<Effect.Success<ReturnType<typeof reviewNamed>>>): Effect.Effect<Target> =>
  Effect.gen(function* () {
    const link = hostLink(found.review, found.project);
    const host = link ? hostOf(link) : undefined;
    if (!link || !host) return { roomOnly: "the review names no pull request" };
    const named = yield* host.pull(link, found.review.branch);
    if ("none" in named) return { roomOnly: named.none };
    if (named.pull.state !== "open") return { roomOnly: `pull request #${named.pull.number} is ${named.pull.state}` };
    return { host, link, number: named.pull.number };
  });

/** Say a comment on a review's code: onto the open pull request first, when
 *  there is one (so a refusal there leaves nothing half-said), then on the
 *  room's log as the reader's, with where it went on the host. */
const say = (found: NonNullable<Effect.Success<ReturnType<typeof reviewNamed>>>, to: Target, spot: Spot, commit: string, body: string, drafted: boolean) =>
  Effect.gen(function* () {
    // the room's log takes it first: a room not yet admitted says so before
    // anything reaches the host, so nothing is half-said
    if (!(yield* SubscriptionRef.get(found.room.writable))) return { error: "not admitted to the room's log yet — try again once a member is online" } satisfies HostWrite;
    let host: { readonly id: number; readonly url: string } | undefined;
    let shown: LineComment | undefined;
    if ("host" in to) {
      const posted = yield* to.host.comment(to.link, to.number, { file: spot.file, line: spot.line, side: spot.side, commit, ...(spot.startLine !== undefined ? { start: { line: spot.startLine, side: spot.startSide ?? spot.side } } : {}) }, body);
      if ("error" in posted) return posted satisfies HostWrite;
      if (posted.comment) {
        shown = posted.comment;
        host = { id: Number(posted.comment.id), url: posted.comment.url };
      }
    }
    const { identity, nameRef } = yield* IdentityService;
    const name = yield* SubscriptionRef.get(nameRef);
    const comment: ReviewComment = {
      id: randomUUID(),
      ticketId: found.ticket.id,
      author: identity.pubkey,
      authorName: name,
      ...spot,
      commit,
      body,
      ...(drafted ? { drafted: true } : {}),
      ...(host ? { host } : {}),
      ts: Date.now(),
    };
    const logged = yield* found.room.comment(comment).pipe(
      Effect.as(true),
      Effect.catchTag("NotWritable", () => Effect.succeed(false)),
    );
    if (!logged) return { error: `the room's log refused it${host ? ` — it is on the pull request: ${host.url}` : ""}` } satisfies HostWrite;
    return { ok: true as const, comment: shown ?? asShown(comment) } satisfies HostWrite;
  });

/** A comment said in the room, as the page shows one. */
const asShown = (c: ReviewComment): LineComment & { readonly hostId?: string } => ({
  id: c.id,
  author: { login: c.authorName },
  body: c.body,
  file: c.file,
  line: c.line,
  side: c.side,
  ...(c.startLine !== undefined ? { startLine: c.startLine, startSide: c.startSide ?? c.side } : {}),
  url: c.host?.url ?? "",
  at: new Date(c.ts).toISOString(),
  ...(c.drafted ? { drafted: true as const } : {}),
  ...(c.host ? { hostId: String(c.host.id) } : {}),
});

/** A comment the reader typed on the page, said at once. */
export const sayComment = Effect.fn("ReviewTalk.say")(function* (ticketId: string, spot: Spot, commit: string, body: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies HostWrite;
  const text = body.trim();
  if (text.length === 0) return { error: "Write the comment first." } satisfies HostWrite;
  return yield* say(found, yield* hostFor(found), spot, commit, text, false);
});

/** Accept drafts — the ones named, or all — each said as the reader's, with
 *  its words as edited where an edit is given. One the host refuses stays a
 *  draft, with why; the rest are said and leave the drafts. */
export const acceptDrafts = Effect.fn("ReviewTalk.accept")(function* (ticketId: string, ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>> = {}) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { said: 0, failed: [{ id: "", error: `no review ticket ${ticketId} in your rooms` }] } satisfies AcceptResult;
  const waiting = yield* draftsOf(ticketId);
  const chosen = ids === null ? waiting : waiting.filter((d) => ids.includes(d.id));
  const missing = ids === null ? [] : ids.filter((id) => !waiting.some((d) => d.id === id));
  const failed: Array<{ readonly id: string; readonly error: string }> = missing.map((id) => ({ id, error: "no such draft — said or declined already" }));
  if (chosen.length === 0) return { said: 0, failed } satisfies AcceptResult;
  const to = yield* hostFor(found);
  const done: Array<string> = [];
  for (const d of chosen) {
    const body = (edits[d.id] ?? d.body).trim();
    if (body.length === 0) {
      failed.push({ id: d.id, error: "it says nothing — decline it instead" });
      continue;
    }
    const r = yield* say(found, to, spotOf(d), d.commit, body, true);
    if ("error" in r) failed.push({ id: d.id, error: r.error });
    else done.push(d.id);
  }
  if (done.length > 0) yield* setDrafts(ticketId, (ds) => ds.filter((d) => !done.includes(d.id)));
  return { said: done.length, failed, ...("roomOnly" in to ? { roomOnly: to.roomOnly } : {}) } satisfies AcceptResult;
});

/** Decline drafts — the ones named, or all: gone, said nowhere. */
export const declineDrafts = Effect.fn("ReviewTalk.decline")(function* (ticketId: string, ids: ReadonlyArray<string> | null) {
  const before = (yield* draftsOf(ticketId)).length;
  yield* setDrafts(ticketId, (ds) => (ids === null ? [] : ds.filter((d) => !ids.includes(d.id))));
  return before - (yield* draftsOf(ticketId)).length;
});

/** The comments on a review collagen holds, for the page: the drafts waiting
 *  here, and what has been said in the room. */
export const talkView = Effect.fn("ReviewTalk.view")(function* (ticketId: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { drafts: [], said: [] } satisfies TalkView;
  const drafts = (yield* draftsOf(ticketId)).map(({ id, file, line, side, startLine, startSide, body }) => ({ id, file, line, side, ...(startLine !== undefined ? { startLine, startSide: startSide ?? side } : {}), body }));
  const said = (yield* SubscriptionRef.get(found.room.comments)).filter((c) => c.ticketId === ticketId).map(asShown);
  return { drafts, said } satisfies TalkView;
});
