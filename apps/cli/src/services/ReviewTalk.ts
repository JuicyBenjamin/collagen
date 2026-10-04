import { randomUUID } from "node:crypto";
import { Effect, SubscriptionRef } from "effect";
import type { DraftComment, ReviewComment } from "@collagen/p2p";
import type { DraftsResult, DraftView, HostWrite, LineComment, SubmitResult, TalkView, Verdict } from "@collagen/review-web/data";
import { placeComment, type Spot } from "../lib/comments";
import { IdentityService } from "./Identity";
import { hostOf, type RepoHost } from "./RepoHost";
import { hostLink, reviewHunks, reviewNamed } from "./ReviewView";
import { StateStore } from "./StateStore";

// Comments on a review's code, as GitHub has them: a review is written, then
// finished. The reader's AI DRAFTS comments while it reviews; accepted (as
// they are, or edited), a draft joins the reader's review in progress —
// PENDING, with the comments they write on the page themselves. Drafts and
// pending comments are this machine's only. FINISHING the review says them
// all at once: on the room's log as the reader's (ReviewComments — the
// author's agent reads them in review-context) and, when the review has an
// open pull request, on it as one review with the reader's verdict, through
// their own gh — wired here, so neither the page nor the AI calls GitHub. A
// single comment can still be said at once, as GitHub's "Add single comment".

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

type Found = NonNullable<Effect.Success<ReturnType<typeof reviewNamed>>>;

const spotOf = (d: { readonly file: string; readonly line: number; readonly side: "LEFT" | "RIGHT"; readonly startLine?: number; readonly startSide?: "LEFT" | "RIGHT" }): Spot => ({
  file: d.file,
  line: d.line,
  side: d.side,
  ...(d.startLine !== undefined ? { startLine: d.startLine, startSide: d.startSide ?? d.side } : {}),
});

const isPending = (d: DraftComment) => d.status === "pending";

/** What is not said yet on a review, on this machine: the AI's drafts and the reader's pending comments. */
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
    else kept.push({ id: randomUUID(), ticketId, ...spot, body: item.body.trim(), commit: diff.commit, status: "ai", ts: now + i });
  });
  if (kept.length > 0) yield* setDrafts(ticketId, (ds) => [...ds, ...kept]);
  return { drafted: kept, refused };
});

/** Accept AI drafts — the ones named, or all — into the reader's review: they
 *  are pending now, with their words as edited where an edit is given, and
 *  said when the review is finished. */
export const acceptDrafts = Effect.fn("ReviewTalk.accept")(function* (ticketId: string, ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>> = {}) {
  const waiting = (yield* draftsOf(ticketId)).filter((d) => !isPending(d));
  const chosen = ids === null ? waiting : waiting.filter((d) => ids.includes(d.id));
  const failed: Array<{ readonly id: string; readonly error: string }> = (ids ?? []).filter((id) => !waiting.some((d) => d.id === id)).map((id) => ({ id, error: "no such draft — accepted or declined already" }));
  const moved = new Map<string, string>();
  for (const d of chosen) {
    const body = (edits[d.id] ?? d.body).trim();
    if (body.length === 0) failed.push({ id: d.id, error: "it says nothing — decline it instead" });
    else moved.set(d.id, body);
  }
  if (moved.size > 0) yield* setDrafts(ticketId, (ds) => ds.map((d) => (moved.has(d.id) ? { ...d, body: moved.get(d.id)!, status: "pending" as const, drafted: true } : d)));
  return { done: moved.size, failed } satisfies DraftsResult;
});

/** A comment the reader wrote on the page, into their review: pending, said when they finish it. */
export const addToReview = Effect.fn("ReviewTalk.addToReview")(function* (ticketId: string, spot: Spot, commit: string, body: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies HostWrite;
  const text = body.trim();
  if (text.length === 0) return { error: "Write the comment first." } satisfies HostWrite;
  const d: DraftComment = { id: randomUUID(), ticketId, ...spot, commit, body: text, status: "pending", ts: Date.now() };
  yield* setDrafts(ticketId, (ds) => [...ds, d]);
  return { ok: true as const } satisfies HostWrite;
});

/** New words for a pending comment or a draft. */
export const editDraft = Effect.fn("ReviewTalk.edit")(function* (ticketId: string, id: string, body: string) {
  const text = body.trim();
  if (text.length === 0) return { done: 0, failed: [{ id, error: "it says nothing — delete it instead" }] } satisfies DraftsResult;
  if (!(yield* draftsOf(ticketId)).some((d) => d.id === id)) return { done: 0, failed: [{ id, error: "no such comment — said or deleted already" }] } satisfies DraftsResult;
  yield* setDrafts(ticketId, (ds) => ds.map((d) => (d.id === id ? { ...d, body: text } : d)));
  return { done: 1, failed: [] } satisfies DraftsResult;
});

/** Drop drafts or pending comments — the ones named; or, with none named,
 *  every one of a kind: the AI's drafts ("ai") or the review's ("pending"). */
export const dropDrafts = Effect.fn("ReviewTalk.drop")(function* (ticketId: string, ids: ReadonlyArray<string> | null, kind: "ai" | "pending" = "ai") {
  const before = (yield* draftsOf(ticketId)).length;
  yield* setDrafts(ticketId, (ds) => ds.filter((d) => (ids === null ? (kind === "pending" ? !isPending(d) : isPending(d)) : !ids.includes(d.id))));
  return before - (yield* draftsOf(ticketId)).length;
});

/** Where a comment goes besides the room: an open pull request on its host,
 *  or nowhere — and why. */
type Target = { readonly roomOnly: string } | { readonly host: RepoHost; readonly link: string; readonly number: number; readonly author: string };

/** The open pull request comments also go to, if the review has one, its
 *  host takes comments, and it is someone else's — or why they are said in
 *  the room only. On the reader's own pull request (the one signed in to
 *  the host opened it) nothing goes to the host: there they would be the
 *  only one to read it, and collagen holds it already. */
const hostFor = (found: Found): Effect.Effect<Target> =>
  Effect.gen(function* () {
    const link = hostLink(found.review, found.project);
    const host = link ? hostOf(link) : undefined;
    if (!link || !host) return { roomOnly: "the review names no pull request" };
    const named = yield* host.pull(link, found.review.branch);
    if ("none" in named) return { roomOnly: named.none };
    if (named.pull.state !== "open") return { roomOnly: `pull request #${named.pull.number} is ${named.pull.state}` };
    const viewer = yield* host.viewer;
    if ("user" in viewer && viewer.user.login === named.pull.author) return { roomOnly: "it is your own pull request, where you would be its only reader" };
    return { host, link, number: named.pull.number, author: named.pull.author };
  });

/** The room takes nothing from a member not admitted to its log yet — asked
 *  before anything reaches the host, so nothing is half-said. */
const roomRefuses = (found: Found) =>
  SubscriptionRef.get(found.room.writable).pipe(Effect.map((w) => (w ? null : "not admitted to the room's log yet — try again once a member is online")));

/** Put comments on the room's log as the reader's, each with where it is on
 *  the host when it went there too. */
const logComments = (
  found: Found,
  said: ReadonlyArray<{ readonly spot: Spot; readonly commit: string; readonly body: string; readonly drafted: boolean; readonly host?: { readonly id: number; readonly url: string } }>,
): Effect.Effect<{ readonly error: string } | { readonly logged: ReadonlyArray<ReviewComment> }, never, IdentityService> =>
  Effect.gen(function* () {
    const { identity, nameRef } = yield* IdentityService;
    const name = yield* SubscriptionRef.get(nameRef);
    const out: Array<ReviewComment> = [];
    for (const [i, c] of said.entries()) {
      const comment: ReviewComment = {
        id: randomUUID(),
        ticketId: found.ticket.id,
        author: identity.pubkey,
        authorName: name,
        ...c.spot,
        commit: c.commit,
        body: c.body,
        ...(c.drafted ? { drafted: true } : {}),
        ...(c.host ? { host: c.host } : {}),
        ts: Date.now() + i,
      };
      const logged = yield* found.room.comment(comment).pipe(
        Effect.as(true),
        Effect.catchTag("NotWritable", () => Effect.succeed(false)),
      );
      if (!logged) return { error: `the room's log refused it${c.host ? ` — it is on the pull request: ${c.host.url}` : ""}` };
      out.push(comment);
    }
    return { logged: out };
  });

/** A comment said at once, apart from any review — GitHub's "Add single
 *  comment": onto the open pull request first, when there is one (a refusal
 *  there leaves nothing half-said), then on the room's log. */
export const sayComment = Effect.fn("ReviewTalk.say")(function* (ticketId: string, spot: Spot, commit: string, body: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies HostWrite;
  const text = body.trim();
  if (text.length === 0) return { error: "Write the comment first." } satisfies HostWrite;
  const refuses = yield* roomRefuses(found);
  if (refuses) return { error: refuses } satisfies HostWrite;
  const to = yield* hostFor(found);
  let host: { readonly id: number; readonly url: string } | undefined;
  let shown: LineComment | undefined;
  if ("host" in to) {
    const posted = yield* to.host.comment(to.link, to.number, { file: spot.file, line: spot.line, side: spot.side, commit, ...(spot.startLine !== undefined ? { start: { line: spot.startLine, side: spot.startSide ?? spot.side } } : {}) }, text);
    if ("error" in posted) return posted satisfies HostWrite;
    if (posted.comment) {
      shown = posted.comment;
      host = { id: Number(posted.comment.id), url: posted.comment.url };
    }
  }
  const r = yield* logComments(found, [{ spot, commit, body: text, drafted: false, ...(host ? { host } : {}) }]);
  if ("error" in r) return { error: r.error } satisfies HostWrite;
  return { ok: true as const, comment: shown ?? asShown(r.logged[0]!) } satisfies HostWrite;
});

/** Finish the reader's review: every pending comment said — on the open pull
 *  request as one review with their verdict and words (GitHub's "Submit
 *  review"), then in the room as theirs. With no pull request the comments
 *  are said in the room alone, and a verdict has nowhere to go. A refusal
 *  anywhere leaves the review pending, all of it. `commit`: the one the
 *  page shows (the review is of it), else the newest a comment was written at. */
export const submitReview = Effect.fn("ReviewTalk.submit")(function* (ticketId: string, verdict: Verdict, body: string, commit: string | null) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies SubmitResult;
  const pending = (yield* draftsOf(ticketId)).filter(isPending);
  const text = body.trim();
  const refuses = yield* roomRefuses(found);
  if (refuses) return { error: refuses } satisfies SubmitResult;
  const to = yield* hostFor(found);
  if ("roomOnly" in to) {
    if (verdict !== "comment") return { error: `Cannot ${verdict === "approve" ? "approve" : "request changes"} here — ${to.roomOnly.replace(/\.$/, "")}. Your take on the ticket itself goes through your agent.` } satisfies SubmitResult;
    if (pending.length === 0) return { error: "Nothing to finish: no comments are pending in your review." } satisfies SubmitResult;
    const r = yield* logComments(found, pending.map((d) => ({ spot: spotOf(d), commit: d.commit, body: d.body, drafted: d.drafted === true })));
    if ("error" in r) return { error: r.error } satisfies SubmitResult;
    yield* setDrafts(ticketId, (ds) => ds.filter((d) => !pending.some((p) => p.id === d.id)));
    return { ok: true as const, said: pending.length, roomOnly: to.roomOnly } satisfies SubmitResult;
  }
  if (verdict === "request-changes" && text.length === 0) return { error: "Say what should change — GitHub asks for it." } satisfies SubmitResult;
  if (verdict === "comment" && text.length === 0 && pending.length === 0) return { error: "Write something, or add comments to your review first." } satisfies SubmitResult;
  if (verdict !== "comment") {
    const viewer = yield* to.host.viewer;
    if ("user" in viewer && viewer.user.login === to.author) return { error: "You opened this pull request: GitHub does not let you approve or request changes on your own." } satisfies SubmitResult;
  }
  // the commit the review is of: the page's; else the newest a pending comment
  // was written at; else the branch as the reader's clone has it now
  let at = commit ?? [...pending].sort((a, b) => b.ts - a.ts)[0]?.commit;
  if (!at) {
    const diff = yield* reviewHunks(found);
    if ("error" in diff) return { error: `cannot read the review's code here: ${diff.error}` } satisfies SubmitResult;
    at = diff.commit;
  }
  const sent = yield* to.host.submit(to.link, to.number, {
    verdict,
    body: text,
    commit: at,
    comments: pending.map((d) => ({ file: d.file, line: d.line, side: d.side, body: d.body, ...(d.startLine !== undefined ? { start: { line: d.startLine, side: d.startSide ?? d.side } } : {}) })),
  });
  if ("error" in sent) return sent satisfies SubmitResult;
  // each pending comment with its copy on the host, matched by where it sits and what it says
  const unclaimed = [...sent.comments];
  const said = pending.map((d) => {
    const i = unclaimed.findIndex((c) => c.file === d.file && c.line === d.line && c.side === d.side && c.body === d.body);
    const copy = i === -1 ? undefined : unclaimed.splice(i, 1)[0];
    return { spot: spotOf(d), commit: at, body: d.body, drafted: d.drafted === true, ...(copy ? { host: { id: Number(copy.id), url: copy.url } } : {}) };
  });
  yield* setDrafts(ticketId, (ds) => ds.filter((d) => !pending.some((p) => p.id === d.id)));
  const r = yield* logComments(found, said);
  if ("error" in r) return { error: r.error } satisfies SubmitResult;
  return { ok: true as const, said: pending.length, ...(sent.url ? { url: sent.url } : {}) } satisfies SubmitResult;
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

const asDraft = (d: DraftComment): DraftView => ({
  id: d.id,
  file: d.file,
  line: d.line,
  side: d.side,
  ...(d.startLine !== undefined ? { startLine: d.startLine, startSide: d.startSide ?? d.side } : {}),
  body: d.body,
  ...(d.drafted ? { drafted: true as const } : {}),
});

/** The comments on a review collagen holds, for the page: the AI's drafts and
 *  the pending review here, and what has been said in the room. */
export const talkView = Effect.fn("ReviewTalk.view")(function* (ticketId: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { drafts: [], pending: [], said: [] } satisfies TalkView;
  const mine = yield* draftsOf(ticketId);
  const said = (yield* SubscriptionRef.get(found.room.comments)).filter((c) => c.ticketId === ticketId).map(asShown);
  return { drafts: mine.filter((d) => !isPending(d)).map(asDraft), pending: mine.filter(isPending).map(asDraft), said } satisfies TalkView;
});
