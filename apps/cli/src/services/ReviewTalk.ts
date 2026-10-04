import { randomUUID } from "node:crypto";
import { Effect, Semaphore, SubscriptionRef } from "effect";
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
const isAi = (d: DraftComment) => d.status === "ai" || d.status === undefined;
/** On the pull request already, not yet in the room: held as it is until a
 *  finish tells the room — never edited, moved or dropped. */
const isPosted = (d: DraftComment) => d.status === "posted";

/** What is not said yet on a review, on this machine: the AI's drafts and the reader's pending comments. */
export const draftsOf = (ticketId: string) => StateStore.use((s) => s.get).pipe(Effect.map((state): ReadonlyArray<DraftComment> => state.drafts?.[ticketId] ?? []));

/** The ids of the reader's latest finishes of a review from the page. */
const finishedOf = (ticketId: string) => StateStore.use((s) => s.get).pipe(Effect.map((state): ReadonlyArray<string> => state.finished?.[ticketId] ?? []));

/** Change a review's drafts — and, with `finished`, record that finish as
 *  done in the same write, so it is never half recorded. */
const setDrafts = (ticketId: string, f: (ds: ReadonlyArray<DraftComment>) => ReadonlyArray<DraftComment>, finished: string | null = null) =>
  StateStore.use((s) =>
    s.update((state) => {
      const next = f(state.drafts?.[ticketId] ?? []);
      const { [ticketId]: _gone, ...rest } = state.drafts ?? {};
      const before = state.finished?.[ticketId] ?? [];
      return {
        ...state,
        drafts: next.length > 0 ? { ...rest, [ticketId]: [...next] } : rest,
        ...(finished !== null ? { finished: { ...state.finished, [ticketId]: [...before.filter((id) => id !== finished), finished].slice(-20) } } : {}),
      };
    }),
  );

/** One write at a time per review: every change to its drafts and pending
 *  comments waits while a finish is under way — two tabs, or the page and
 *  the agent, can neither finish it twice nor delete what is being sent. */
const locks = new Map<string, Semaphore.Semaphore>();
const one = <A, E, R>(ticketId: string, effect: Effect.Effect<A, E, R>) => {
  let lock = locks.get(ticketId);
  if (!lock) {
    lock = Semaphore.makeUnsafe(1);
    locks.set(ticketId, lock);
  }
  return lock.withPermit(effect);
};



/** Draft comments on a review's code, each placed on the diff as the reader's
 *  clone has it now (the commit it was read at goes with it): what cannot sit
 *  on a line of the diff is refused, with why, and the rest kept. */
export const draftComments = (ticketId: string, items: ReadonlyArray<DraftInput>) => one(ticketId, draftOnce(ticketId, items));
const draftOnce = Effect.fn("ReviewTalk.draft")(function* (ticketId: string, items: ReadonlyArray<DraftInput>) {
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
export const acceptDrafts = (ticketId: string, ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>> = {}) => one(ticketId, acceptOnce(ticketId, ids, edits));
const acceptOnce = Effect.fn("ReviewTalk.accept")(function* (ticketId: string, ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>>) {
  const waiting = (yield* draftsOf(ticketId)).filter(isAi);
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
export const addToReview = (ticketId: string, spot: Spot, commit: string, body: string) => one(ticketId, addOnce(ticketId, spot, commit, body));
const addOnce = Effect.fn("ReviewTalk.addToReview")(function* (ticketId: string, spot: Spot, commit: string, body: string) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies HostWrite;
  const text = body.trim();
  if (text.length === 0) return { error: "Write the comment first." } satisfies HostWrite;
  const d: DraftComment = { id: randomUUID(), ticketId, ...spot, commit, body: text, status: "pending", ts: Date.now() };
  yield* setDrafts(ticketId, (ds) => [...ds, d]);
  return { ok: true as const } satisfies HostWrite;
});

/** New words for a pending comment or a draft. */
export const editDraft = (ticketId: string, id: string, body: string) => one(ticketId, editOnce(ticketId, id, body));
const editOnce = Effect.fn("ReviewTalk.edit")(function* (ticketId: string, id: string, body: string) {
  const text = body.trim();
  if (text.length === 0) return { done: 0, failed: [{ id, error: "it says nothing — delete it instead" }] } satisfies DraftsResult;
  if (!(yield* draftsOf(ticketId)).some((d) => d.id === id && !isPosted(d))) return { done: 0, failed: [{ id, error: "no such comment — said or deleted already" }] } satisfies DraftsResult;
  yield* setDrafts(ticketId, (ds) => ds.map((d) => (d.id === id ? { ...d, body: text } : d)));
  return { done: 1, failed: [] } satisfies DraftsResult;
});

/** Drop drafts or pending comments — the ones named; or, with none named,
 *  every one of a kind: the AI's drafts ("ai") or the review's ("pending"). */
export const dropDrafts = (ticketId: string, ids: ReadonlyArray<string> | null, kind: "ai" | "pending" = "ai") => one(ticketId, dropOnce(ticketId, ids, kind));
const dropOnce = Effect.fn("ReviewTalk.drop")(function* (ticketId: string, ids: ReadonlyArray<string> | null, kind: "ai" | "pending") {
  const before = (yield* draftsOf(ticketId)).length;
  yield* setDrafts(ticketId, (ds) => ds.filter((d) => isPosted(d) || (ids === null ? !(kind === "pending" ? isPending(d) : isAi(d)) : !ids.includes(d.id))));
  return before - (yield* draftsOf(ticketId)).length;
});

/** Where a comment goes besides the room: an open pull request on its host,
 *  or nowhere — and why. */
type Target = { readonly roomOnly: string } | { readonly refused: string } | { readonly host: RepoHost; readonly link: string; readonly number: number; readonly author: string };

/** The open pull request comments also go to, if the review has one, its
 *  host takes comments, and it is someone else's — or why they are said in
 *  the room only. On the reader's own pull request (the one signed in to
 *  the host opened it) nothing goes to the host: there they would be the
 *  only one to read it, and collagen holds it already. */
const hostFor = (found: Found, shownAs: string | null): Effect.Effect<Target> =>
  Effect.gen(function* () {
    const link = hostLink(found.review, found.project);
    const host = link ? hostOf(link) : undefined;
    if (!link || !host) return { roomOnly: "the review names no pull request" };
    const named = yield* host.pull(link, found.review.branch);
    if ("none" in named) return { roomOnly: named.none };
    if (named.pull.state !== "open") return { roomOnly: `pull request #${named.pull.number} is ${named.pull.state}` };
    // a write goes out under whoever gh is signed in as now — asked again,
    // never remembered; if the page showed someone else, it says so first
    const viewer = yield* host.viewerNow;
    if (!("user" in viewer)) return { refused: viewer.signIn };
    if (shownAs !== null && viewer.user.login !== shownAs) return { refused: `gh is signed in as ${viewer.user.login} now, not ${shownAs} as the page showed — reload the page to see whose name this goes out under.` };
    if (viewer.user.login === named.pull.author) return { roomOnly: "it is your own pull request, where you would be its only reader" };
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
  said: ReadonlyArray<{ readonly id?: string; readonly spot: Spot; readonly commit: string; readonly body: string; readonly drafted: boolean; readonly host?: { readonly id: number; readonly url: string } }>,
): Effect.Effect<{ readonly error: string } | { readonly logged: ReadonlyArray<ReviewComment> }, never, IdentityService> =>
  Effect.gen(function* () {
    const { identity, nameRef } = yield* IdentityService;
    const name = yield* SubscriptionRef.get(nameRef);
    const out: Array<ReviewComment> = [];
    for (const [i, c] of said.entries()) {
      const comment: ReviewComment = {
        // a draft's own id: said again after a stop half way, it is the same comment
        id: c.id ?? randomUUID(),
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
export const sayComment = (ticketId: string, spot: Spot, commit: string, body: string, shownAs: string | null) => one(ticketId, sayOnce(ticketId, spot, commit, body, shownAs));
const sayOnce = Effect.fn("ReviewTalk.say")(function* (ticketId: string, spot: Spot, commit: string, body: string, shownAs: string | null) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies HostWrite;
  const text = body.trim();
  if (text.length === 0) return { error: "Write the comment first." } satisfies HostWrite;
  const refuses = yield* roomRefuses(found);
  if (refuses) return { error: refuses } satisfies HostWrite;
  const to = yield* hostFor(found, shownAs);
  if ("refused" in to) return { error: to.refused } satisfies HostWrite;
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

/** A finish from the page: its own id, and the pending comments it saw. */
export interface Finish {
  readonly id: string;
  readonly pending: ReadonlyArray<string>;
}

const short = (c: string) => c.slice(0, 7);

/** Finish the reader's review: every pending comment said — on the open pull
 *  request as one review with their verdict and words (GitHub's "Submit
 *  review"), then in the room as theirs. With no pull request, or on their
 *  own, the comments are said in the room alone — and a verdict or words on
 *  the whole, having nowhere to go, are refused rather than lost. A refusal
 *  anywhere leaves the review pending, all of it; a finish that stops after
 *  the host has it resumes in the room without writing to the host again.
 *  The review is of one commit: `commit`, the one the page shows (else the
 *  one its comments were written at) — comments written at another are
 *  refused until the reader confirms where they sit. One at a time per review.
 *  From the page a finish names itself and the pending comments it saw
 *  (`seen`): sent again once done, it is not said again; finding the review
 *  changed under it (finished elsewhere, comments come or gone), it is
 *  refused for the reader to look again. */
export const submitReview = (ticketId: string, verdict: Verdict, body: string, commit: string | null, shownAs: string | null, seen: Finish | null = null) =>
  one(ticketId, submitOnce(ticketId, verdict, body, commit, shownAs, seen));
const submitOnce = Effect.fn("ReviewTalk.submit")(function* (ticketId: string, verdict: Verdict, body: string, commit: string | null, shownAs: string | null, seen: Finish | null) {
  const found = yield* reviewNamed(ticketId);
  if (!found) return { error: `no review ticket ${ticketId} in your rooms` } satisfies SubmitResult;
  const mine = yield* draftsOf(ticketId);
  const refuses = yield* roomRefuses(found);
  if (refuses) return { error: refuses } satisfies SubmitResult;
  const sayAll = (ds: ReadonlyArray<DraftComment>) =>
    logComments(found, ds.map((d) => ({ id: d.id, spot: spotOf(d), commit: d.commit, body: d.body, drafted: d.drafted === true, ...(d.host ? { host: d.host } : {}) })));
  const done = (ids: ReadonlyArray<string>, finished: string | null = null) => setDrafts(ticketId, (ds) => ds.filter((d) => !ids.includes(d.id)), finished);

  // an earlier finish that stopped after the host had it: the room is told
  // first — its review, words and verdict are on the host already, never
  // sent again — and whatever this finish brings is a review of its own
  const halfSaid = mine.filter(isPosted);
  if (halfSaid.length > 0) {
    const r = yield* sayAll(halfSaid);
    if ("error" in r) {
      // onHost speaks of this finish only: true when it is the earlier one
      // sent again, never for a new one, whose words and verdict are kept
      const again = seen !== null && (yield* finishedOf(ticketId)).includes(seen.id);
      return again
        ? ({ error: `${r.error} — your review is on the pull request already; finishing again with no words or verdict tells the room`, onHost: true as const } satisfies SubmitResult)
        : ({ error: `Your earlier review is on the pull request, but the room has not taken it yet (${r.error}). Nothing of this finish was sent — try again once the room takes it.` } satisfies SubmitResult);
    }
    yield* done(halfSaid.map((d) => d.id));
  }
  const recovered = halfSaid.length;
  const recoveredIds = new Set(halfSaid.map((d) => d.id));

  const pending = mine.filter(isPending);
  const text = body.trim();
  if (seen !== null) {
    // this very finish again (a retry): done already, nothing said twice
    if ((yield* finishedOf(ticketId)).includes(seen.id)) return { ok: true as const, said: recovered, ...(recovered === 0 ? { already: true as const } : {}) } satisfies SubmitResult;
    const now = new Set(pending.map((d) => d.id));
    const saw = seen.pending.filter((id) => !recoveredIds.has(id));
    if (saw.length !== now.size || saw.some((id) => !now.has(id)))
      return { error: `${recovered > 0 ? `Your earlier review is in the room now (${recovered} comment(s), on the pull request already). ` : ""}Your review changed since the page last read it — finished elsewhere, or comments added or deleted. Look again, then finish it.` } satisfies SubmitResult;
  } else if (recovered > 0 && (pending.length > 0 || text.length > 0 || verdict !== "comment")) {
    // from the agent, words or a verdict here may be the earlier review's sent again: asked, never assumed
    return {
      error: `Your earlier review is in the room now: ${recovered} comment(s), on the pull request already with its words and verdict. Nothing else was sent — if these words, this verdict or the comments pending are a new review, finish it again.`,
    } satisfies SubmitResult;
  }
  // only the room was left to tell
  if (recovered > 0 && pending.length === 0 && text.length === 0 && verdict === "comment") return { ok: true as const, said: recovered } satisfies SubmitResult;
  const to = yield* hostFor(found, shownAs);
  if ("refused" in to) return { error: to.refused } satisfies SubmitResult;
  if ("roomOnly" in to) {
    if (verdict !== "comment") return { error: `Cannot ${verdict === "approve" ? "approve" : "request changes"} here — ${to.roomOnly.replace(/\.$/, "")}. Your take on the ticket itself goes through your agent.` } satisfies SubmitResult;
    if (text.length > 0) return { error: `Words on the whole have nowhere to go here — ${to.roomOnly.replace(/\.$/, "")}. Put them on a line, or give your take on the ticket through your agent; nothing was said.` } satisfies SubmitResult;
    if (pending.length === 0) return { error: "Nothing to finish: no comments are pending in your review." } satisfies SubmitResult;
    // said by their own ids: a stop half way and a second go say each once
    const r = yield* sayAll(pending);
    if ("error" in r) return { error: r.error } satisfies SubmitResult;
    yield* done(pending.map((d) => d.id), seen?.id ?? null);
    return { ok: true as const, said: recovered + pending.length, roomOnly: to.roomOnly } satisfies SubmitResult;
  }

  if (verdict === "request-changes" && text.length === 0) return { error: "Say what should change — GitHub asks for it." } satisfies SubmitResult;
  if (verdict === "comment" && text.length === 0 && pending.length === 0) return { error: "Write something, or add comments to your review first." } satisfies SubmitResult;
  // the one commit the review is of; every comment in it written there
  const written = [...new Set(pending.map((d) => d.commit))];
  let at = commit ?? (written.length === 1 ? written[0]! : null);
  if (at === null && written.length === 0) {
    const diff = yield* reviewHunks(found);
    if ("error" in diff) return { error: `cannot read the review's code here: ${diff.error}` } satisfies SubmitResult;
    at = diff.commit;
  }
  const elsewhere = pending.filter((d) => d.commit !== at);
  if (at === null || elsewhere.length > 0)
    return {
      error: `${elsewhere.length || pending.length} comment(s) in your review were written on ${at === null ? "different commits" : `another commit than the one ${commit ? "the page shows" : "the others were"} (${short(at)})`}: their lines may have moved. Confirm where each sits ("Keep it here") or delete it, then finish the review.`,
    } satisfies SubmitResult;
  const sent = yield* to.host.submit(to.link, to.number, {
    verdict,
    body: text,
    commit: at,
    comments: pending.map((d) => ({ file: d.file, line: d.line, side: d.side, body: d.body, ...(d.startLine !== undefined ? { start: { line: d.startLine, side: d.startSide ?? d.side } } : {}) })),
  });
  if ("error" in sent) return sent satisfies SubmitResult;
  // each pending comment with its copy on the host, matched by where it sits and what it says
  const unclaimed = [...sent.comments];
  const posted = pending.map((d): DraftComment => {
    const i = unclaimed.findIndex((c) => c.file === d.file && c.line === d.line && c.side === d.side && c.body === d.body);
    const copy = i === -1 ? undefined : unclaimed.splice(i, 1)[0];
    return { ...d, status: "posted", ...(copy ? { host: { id: Number(copy.id), url: copy.url } } : {}) };
  });
  // the host has it: kept as posted until the room has it too, and the
  // finish recorded as done in the same write
  yield* setDrafts(ticketId, (ds) => ds.map((d) => posted.find((p) => p.id === d.id) ?? d), seen?.id ?? null);
  const r = yield* sayAll(posted);
  if ("error" in r) return { error: `${r.error} — the review is on the pull request with its words and verdict; finishing again with none tells the room without posting it twice`, onHost: true as const } satisfies SubmitResult;
  yield* done(posted.map((d) => d.id));
  return { ok: true as const, said: recovered + pending.length, ...(sent.url ? { url: sent.url } : {}) } satisfies SubmitResult;
});

/** Confirm where a comment not said yet sits, at the commit the page shows
 *  now — after the branch moved under it. */
export const repinDraft = (ticketId: string, id: string, commit: string) => one(ticketId, repinOnce(ticketId, id, commit));
const repinOnce = Effect.fn("ReviewTalk.repin")(function* (ticketId: string, id: string, commit: string) {
  if (!(yield* draftsOf(ticketId)).some((d) => d.id === id && !isPosted(d))) return { done: 0, failed: [{ id, error: "no such comment waiting" }] } satisfies DraftsResult;
  yield* setDrafts(ticketId, (ds) => ds.map((d) => (d.id === id ? { ...d, commit } : d)));
  return { done: 1, failed: [] } satisfies DraftsResult;
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
  commit: d.commit,
  ...(isPosted(d) ? { posted: true as const } : {}),
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
  // half said (on the host, not yet in the room) still reads as pending: finishing again completes it
  return { drafts: mine.filter(isAi).map(asDraft), pending: mine.filter((d) => isPending(d) || isPosted(d)).map(asDraft), said } satisfies TalkView;
});
