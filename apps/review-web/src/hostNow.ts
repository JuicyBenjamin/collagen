import { action, createMemo, createOptimistic, createSignal, isPending, NotReadyError, refresh, type Accessor, type SourceAccessor } from "solid-js";
import { acceptDrafts, addToReview, dropDrafts, editDraft, hostView, repinDraft, sendComment, submitReview, talkView } from "./api";
import type { CommentSpot, DiffSide, DraftsResult, DraftView, HostUser, HostView, HostWrite, LineComment, SubmitResult, TalkView, Verdict } from "./data";
import { diffNow } from "./diffNow";
import { onceEach } from "./sameComment";
import { ticketId } from "./ticket";

// The review on its host (GitHub), and the comments collagen holds on it, as
// the page holds them: read once the page is up and again whenever the
// review's state moves, and never in the way of the diff — GitHub is a
// network away, so a part not read yet reads as nothing here instead of
// holding the page (`ready`). Comments are the pull request's and the room's,
// each shown once; the drafts are what the reader's AI wrote, waiting on them.
// Both are optimistic: a comment posted, or a draft accepted, shows under its
// line at once and stays until the answer replaces it — or goes, with the
// reason, if it was refused; a draft declined goes at once.

type Host = Extract<HostView, { readonly host: string }>;

let view: SourceAccessor<HostView> | null = null;
/** The host's last answer, standing while it is asked again. */
let lastView: HostView | null = null;
let talk: SourceAccessor<TalkView> | null = null;
let comments: Accessor<ReadonlyArray<LineComment>> = () => [];
let setComments: (f: (l: ReadonlyArray<LineComment>) => ReadonlyArray<LineComment>) => void = () => {};
let drafts: Accessor<ReadonlyArray<DraftView>> = () => [];
let setDrafts: (f: (l: ReadonlyArray<DraftView>) => ReadonlyArray<DraftView>) => void = () => {};
let pending: Accessor<ReadonlyArray<DraftView>> = () => [];
let setPending: (f: (l: ReadonlyArray<DraftView>) => ReadonlyArray<DraftView>) => void = () => {};

/** A value still being read is nothing yet: the page goes on without it. */
const ready = <T>(read: () => T, otherwise: T): T => {
  try {
    return read();
  } catch (error) {
    if (error instanceof NotReadyError) return otherwise;
    throw error;
  }
};

/** Which line a comment is on: a file, a side, a line number. */
const spot = (file: string, side: DiffSide, line: number) => `${side}:${line}:${file}`;
/** Whether a comment sits on that line — never one on a whole file. */
const onLine = (comment: CommentSpot, at: string) => comment.subject !== "file" && spot(comment.file, comment.side, comment.line) === at;
/** Whether a comment is on that whole file. */
const onFile = (comment: CommentSpot, file: string) => comment.subject === "file" && comment.file === file;
/** Where a comment not said yet sits, and nothing else of it. */
const placeOf = (draft: DraftView): CommentSpot =>
  draft.subject === "file"
    ? { subject: "file", file: draft.file }
    : { file: draft.file, line: draft.line, side: draft.side, ...(draft.startLine !== undefined ? { startLine: draft.startLine, startSide: draft.startSide ?? draft.side } : {}) };

/** Lines picked for a comment, in one hunk (GitHub's own rule: a comment's
 *  lines are in one hunk of the diff), by row: where the pointer went down,
 *  and where it is now — one line, or a block dragged or shift-clicked out.
 *  One pick at a time on the page; its composer opens under its last row. */
export interface Pick {
  readonly hunk: string;
  readonly anchor: number;
  readonly focus: number;
}
const [pick, setPick] = createSignal<Pick | null>(null);

// When GitHub is asked again — never on a timer: when the page opens, when
// the review's state moves (a push, a revision), after anything sent from
// here, on the reader's Refresh, and when they come back to the tab after a
// while away. `asked` moves to ask again.
const [asked, setAsked] = createSignal(0);
const STALE_AFTER_MS = 60_000;
/** The page's clock for "checked 2 min ago", moved twice a minute. */
const [now, setNow] = createSignal(Date.now());
if (typeof window !== "undefined") {
  setInterval(() => setNow(Date.now()), 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    setNow(Date.now());
    const at = hostNow.checkedAt();
    if (at !== null && Date.now() - at > STALE_AFTER_MS) setAsked((count) => count + 1);
  });
}
/** Why a draft could not be said, by its id — kept apart from the draft, so
 *  it survives the draft coming back when the optimistic accept is undone. */
const [refusals, setRefusals] = createSignal<Readonly<Record<string, string>>>({});
const [dragging, setDragging] = createSignal(false);
/** The finish the reader is about to make, named: the same when sent again
 *  after a refusal, a new one once a finish is done. */
let finishId = crypto.randomUUID();

export const hostNow = {
  /** Made once by the page, read again each time `state` (the review's live token) moves. */
  start(state: Accessor<unknown>): void {
    const hostMemo = createMemo(() => {
      state();
      asked();
      return hostView(ticketId);
    });
    view = hostMemo;
    const talkMemo = createMemo(() => {
      state();
      return talkView(ticketId);
    });
    talk = talkMemo;
    // the pull request's comments, then the room's that are not on it — one each
    const [list, set] = createOptimistic(() => {
      const host = ready(hostMemo, null);
      return onceEach(host && "host" in host ? host.comments : [], ready(talkMemo, null)?.said ?? []);
    });
    comments = list;
    setComments = set;
    const [waiting, setWaiting] = createOptimistic(() => ready(talkMemo, null)?.drafts ?? []);
    drafts = waiting;
    setDrafts = setWaiting;
    const [inReview, setInReview] = createOptimistic(() => ready(talkMemo, null)?.pending ?? []);
    pending = inReview;
    setPending = setInReview;
  },

  /** The review on its host, once read; null until then. Asked again, the
   *  last answer stands until the new one is in — nothing on the page goes
   *  back to waiting for it. */
  view: (): HostView | null => {
    const now = view ? ready(view, null) : null;
    if (now !== null) lastView = now;
    return now ?? lastView;
  },

  /** The host's part when there is one (a pull request may still be missing). */
  host: (): Host | null => {
    const current = hostNow.view();
    return current && "host" in current ? current : null;
  },

  /** The host's name for people — "GitHub" — or a word for it before it is read. */
  hostName: (): string => hostNow.host()?.host ?? "the host",

  /** Ask the host again now — the reader's Refresh. */
  refresh: (): void => {
    setAsked((count) => count + 1);
  },
  /** When the host was last asked (ms), or null before it has been. */
  checkedAt: (): number | null => {
    const host = hostNow.host();
    return host ? Date.parse(host.checkedAt) : null;
  },
  /** Is it being asked right now (a refresh on its way). */
  checking: (): boolean => {
    try {
      return view ? isPending(() => view!()) : false;
    } catch {
      return true;
    }
  },
  now,

  /** The stack the branch sits in, host or not (the room's reviews make one too). */
  stack: () => hostNow.view()?.stack ?? null,

  /** Can the reader comment on lines here: the diff is their clone's, at a
   *  commit — said in the room, and on the pull request too when there is one. */
  canComment: (): boolean => diffNow.commit() !== undefined,

  /** Can the reader act on the pull request from here: signed in, it is
   *  open, and it is someone else's. */
  canWrite: (): boolean => {
    const host = hostNow.host();
    // someone else's: on the reader's own, comments stay in collagen
    return host !== null && host.viewer !== null && host.pull?.state === "open" && !host.pull.mine;
  },

  /** The drafts the reader's AI left on one line (a block's on its last). */
  draftsAt: (file: string, side: DiffSide, line: number): ReadonlyArray<DraftView> => {
    const at = spot(file, side, line);
    return ready(drafts, []).filter((draft) => onLine(draft, at));
  },
  /** The drafts the reader's AI left on a whole file. */
  draftsOn: (file: string): ReadonlyArray<DraftView> => ready(drafts, []).filter((draft) => onFile(draft, file)),
  /** How many drafts are waiting, and their ids. */
  drafts: (): ReadonlyArray<DraftView> => ready(drafts, []),

  /** Accept AI drafts — these, or all (null) — into the reader's review: they
   *  show as pending in it at once, with the words as edited. */
  accept: action(function* (ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>> = {}) {
    const chosen = ready(drafts, []).filter((draft) => ids === null || ids.includes(draft.id));
    setDrafts((current) => current.filter((draft) => !chosen.includes(draft)));
    setPending((current) => [...current, ...chosen.map((draft) => ({ ...draft, body: edits[draft.id] ?? draft.body, drafted: true as const }))]);
    const result = (yield acceptDrafts(ticketId, ids, edits)) as DraftsResult;
    note(chosen.map((draft) => draft.id), result.failed);
    if (talk) refresh(talk);
    return result;
  }),
  /** Why a draft or a pending comment could not be taken the last time, if it could not. */
  refusal: (id: string): string | undefined => refusals()[id],
  /** Decline AI drafts — these, or all (null): gone at once, said nowhere. */
  decline: action(function* (ids: ReadonlyArray<string> | null) {
    setDrafts((current) => current.filter((draft) => ids !== null && !ids.includes(draft.id)));
    yield dropDrafts(ticketId, ids, "ai");
    if (talk) refresh(talk);
  }),

  /** The comments pending in the reader's review, and those on one line. */
  pending: (): ReadonlyArray<DraftView> => ready(pending, []),
  pendingAt: (file: string, side: DiffSide, line: number): ReadonlyArray<DraftView> => {
    const at = spot(file, side, line);
    return ready(pending, []).filter((draft) => onLine(draft, at));
  },
  /** The comments pending in the reader's review on a whole file. */
  pendingOn: (file: string): ReadonlyArray<DraftView> => ready(pending, []).filter((draft) => onFile(draft, file)),
  /** A comment into the reader's review — on lines, or on a whole file —
   *  pending until they finish it, shown at once. */
  addToReview: action(function* (at: CommentSpot, body: string) {
    const commit = diffNow.commit();
    if (!commit) return { error: "The page does not know which commit its diff is." } as HostWrite;
    setPending((current) => [...current, { id: `new-${Date.now()}`, commit, ...at, body }]);
    const result = (yield addToReview(ticketId, at, body, commit)) as HostWrite;
    if (talk) refresh(talk);
    return result;
  }),
  /** New words for a pending comment (or a draft), shown at once. */
  edit: action(function* (id: string, body: string) {
    setPending((current) => current.map((draft) => (draft.id === id ? { ...draft, body } : draft)));
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, body } : draft)));
    const result = (yield editDraft(ticketId, id, body)) as DraftsResult;
    note([id], result.failed);
    if (talk) refresh(talk);
    return result;
  }),
  /** Take comments out of the reader's review — these, or all (null). */
  unpend: action(function* (ids: ReadonlyArray<string> | null) {
    setPending((current) => current.filter((draft) => ids !== null && !ids.includes(draft.id)));
    yield dropDrafts(ticketId, ids, "pending");
    if (talk) refresh(talk);
  }),
  /** The drafts and pending comments on no line the diff shows. */
  unplaced: (): ReadonlyArray<DraftView> => (diffNow.commit() ? [...ready(pending, []), ...ready(drafts, [])].filter((draft) => !shown(draft)) : []),
  /** Whether it is one of the AI's drafts, not in the review yet. */
  isDraft: (draft: DraftView): boolean => ready(drafts, []).some((other) => other.id === draft.id),
  /** Whether a comment not said yet was written at another commit than the
   *  one the page shows — its lines may have moved since. */
  moved: (draft: DraftView): boolean => {
    const at = diffNow.commit();
    return at !== null && at !== undefined && draft.commit !== at;
  },
  /** Confirm a comment where it shows now, at the commit the page shows. */
  repin: action(function* (id: string) {
    const commit = diffNow.commit();
    if (!commit) return;
    setPending((current) => current.map((draft) => (draft.id === id ? { ...draft, commit } : draft)));
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, commit } : draft)));
    const result = (yield repinDraft(ticketId, id, commit)) as DraftsResult;
    note([id], result.failed);
    if (talk) refresh(talk);
  }),
  /** Finish the review: a verdict, words, and every pending comment, said at
   *  once — each shows as on its way until the host and the room have it;
   *  a refusal leaves the review pending, all of it. */
  submit: action(function* (verdict: Verdict, body: string): Generator<Promise<SubmitResult>, SubmitResult, unknown> {
    const me: HostUser | null | undefined = hostNow.host()?.viewer;
    const going = ready(pending, []);
    setPending(() => []);
    setComments((current) => [...current, ...going.map((draft): LineComment => ({ id: `sending-${draft.id}`, author: me ?? { login: "you" }, body: draft.body, ...placeOf(draft), url: "", at: new Date().toISOString(), pending: true, ...(draft.drafted ? { drafted: true as const } : {}) }))]);
    // this finish, named — sent again it is not said twice — with the
    // review as the page showed it (a comment still on its way has no id yet)
    const seen = { id: finishId, pending: going.map((draft) => draft.id).filter((id) => !id.startsWith("new-")) };
    const result = (yield submitReview(ticketId, verdict, body, diffNow.commit() ?? null, me?.login ?? null, seen)) as SubmitResult;
    // done — or on the host already, its words with it: what comes next is a new finish
    if ("ok" in result || result.onHost) finishId = crypto.randomUUID();
    if (talk) refresh(talk);
    if ("ok" in result && view) refresh(view);
    return result;
  }),

  /** The comments on one line, the reader's own on its way among them. */
  commentsAt: (file: string, side: DiffSide, line: number): ReadonlyArray<LineComment> => {
    const at = spot(file, side, line);
    return ready(comments, []).filter((comment) => onLine(comment, at));
  },
  /** The comments on a whole file, the reader's own on its way among them. */
  commentsOn: (file: string): ReadonlyArray<LineComment> => ready(comments, []).filter((comment) => onFile(comment, file)),

  /** Whether anything is said or waiting on a file: a comment, a pending
   *  comment or a draft — a file holding one is never folded out of sight. */
  talkIn: (file: string): boolean => ready(comments, []).some((comment) => comment.file === file) || ready(pending, []).some((draft) => draft.file === file) || ready(drafts, []).some((draft) => draft.file === file),

  /** The lines picked for a comment, and whether the pointer is still dragging them out. */
  pick,
  dragging,
  /** The pointer went down on a line's +: a new pick there — or, with shift
   *  held, the pick in this hunk stretched to it. Dragging goes on until the
   *  button comes up, anywhere. */
  startPick: (hunk: string, row: number, stretch: boolean): void => {
    const picked = pick();
    setPick(stretch && picked?.hunk === hunk ? { ...picked, focus: row } : { hunk, anchor: row, focus: row });
    setDragging(true);
    window.addEventListener("mouseup", () => setDragging(false), { once: true });
  },
  /** The pointer passed over a line while dragging: the pick reaches it. */
  dragTo: (hunk: string, row: number): void => {
    const picked = pick();
    if (dragging() && picked?.hunk === hunk && picked.focus !== row) setPick({ ...picked, focus: row });
  },
  clearPick: (): void => {
    setPick(null);
  },

  /** Post a single comment — on lines, or on a whole file — at the commit
   *  the page shows, apart from the review (GitHub's "Add single comment").
   *  It shows at once as the reader's, marked as on its way; the host's
   *  answer (read again) takes its place, or a refusal takes it away. */
  comment: action(function* (at: CommentSpot, body: string): Generator<Promise<HostWrite>, HostWrite, unknown> {
    const commit = diffNow.commit();
    if (!commit) return { error: "The page does not know which commit its diff is." } as HostWrite;
    const me: HostUser | null | undefined = hostNow.host()?.viewer;
    const mine: LineComment = { id: `pending-${Date.now()}`, author: me ?? { login: "you" }, body, ...at, url: "", at: new Date().toISOString(), pending: true };
    setComments((current) => [...current, mine]);
    const said = (yield sendComment(ticketId, at, body, commit, me?.login ?? null)) as HostWrite;
    if ("ok" in said) {
      if (talk) refresh(talk);
      if (view) refresh(view);
    }
    return said;
  }),

};

/** Keep why each of `ids` could not be taken, and forget it for the rest. */
function note(ids: ReadonlyArray<string>, failed: ReadonlyArray<{ readonly id: string; readonly error: string }>): void {
  setRefusals((previous) => ({ ...Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.includes(id))), ...Object.fromEntries(failed.map((failure) => [failure.id, failure.error])) }));
}

/** Whether the diff shows where a comment's thread sits: its file, for one
 *  on the whole file; else its line — a removed line on the old side, any
 *  other on the new. */
function shown(draft: DraftView): boolean {
  const hunks = diffNow.hunksOf(draft.file);
  if (draft.subject === "file") return hunks.length > 0;
  return hunks.some((hunk) => hunk.lines.some((line) => (draft.side === "LEFT" ? line.kind === "-" && line.old === draft.line : line.kind !== "-" && line.new === draft.line)));
}
