import { action, createMemo, createOptimistic, createSignal, NotReadyError, refresh, type Accessor, type SourceAccessor } from "solid-js";
import { acceptDrafts, addToReview, dropDrafts, editDraft, hostView, sendLineComment, submitReview, talkView } from "./api";
import type { DraftsResult, DraftView, HostView, HostWrite, LineComment, SubmitResult, TalkView, Verdict } from "./data";
import { diffNow } from "./diffNow";
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
  } catch (e) {
    if (e instanceof NotReadyError) return otherwise;
    throw e;
  }
};

/** Which line a comment is on: a file, a side, a line number. */
const spot = (file: string, side: "LEFT" | "RIGHT", line: number) => `${side}:${line}:${file}`;

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
/** Why a draft could not be said, by its id — kept apart from the draft, so
 *  it survives the draft coming back when the optimistic accept is undone. */
const [refusals, setRefusals] = createSignal<Readonly<Record<string, string>>>({});
const [dragging, setDragging] = createSignal(false);

export const hostNow = {
  /** Made once by the page, read again each time `state` (the review's live token) moves. */
  start(state: Accessor<unknown>): void {
    const v = createMemo(() => {
      state();
      return hostView(ticketId);
    });
    view = v;
    const t = createMemo(() => {
      state();
      return talkView(ticketId);
    });
    talk = t;
    // the pull request's comments, then the room's that are not on it — one each
    const [list, set] = createOptimistic(() => {
      const h = ready(v, null);
      const said = ready(t, null)?.said ?? [];
      // the host's copy of one the reader's AI drafted says so too
      const drafted = new Set(said.flatMap((c) => (c.drafted && c.hostId !== undefined ? [c.hostId] : [])));
      const onHost = (h && "host" in h ? h.comments : []).map((c) => (drafted.has(c.id) ? { ...c, drafted: true as const } : c));
      const ids = new Set(onHost.map((c) => c.id));
      return [...onHost, ...said.filter((c) => c.hostId === undefined || !ids.has(c.hostId))];
    });
    comments = list;
    setComments = set;
    const [waiting, setWaiting] = createOptimistic(() => ready(t, null)?.drafts ?? []);
    drafts = waiting;
    setDrafts = setWaiting;
    const [inReview, setInReview] = createOptimistic(() => ready(t, null)?.pending ?? []);
    pending = inReview;
    setPending = setInReview;
  },

  /** The review on its host, once read; null until then. */
  view: (): HostView | null => (view ? ready(view, null) : null),

  /** The host's part when there is one (a pull request may still be missing). */
  host: (): Host | null => {
    const v = hostNow.view();
    return v && "host" in v ? v : null;
  },

  /** The stack the branch sits in, host or not (the room's reviews make one too). */
  stack: () => hostNow.view()?.stack ?? null,

  /** Can the reader comment on lines here: the diff is their clone's, at a
   *  commit — said in the room, and on the pull request too when there is one. */
  canComment: (): boolean => diffNow.commit() !== undefined,

  /** Can the reader act on the pull request from here: signed in, and it is open. */
  canWrite: (): boolean => {
    const h = hostNow.host();
    return h !== null && h.viewer !== null && h.pull?.state === "open";
  },

  /** The drafts the reader's AI left on one line (a block's on its last). */
  draftsAt: (file: string, side: "LEFT" | "RIGHT", line: number): ReadonlyArray<DraftView> => {
    const at = spot(file, side, line);
    return ready(drafts, []).filter((d) => spot(d.file, d.side, d.line) === at);
  },
  /** How many drafts are waiting, and their ids. */
  drafts: (): ReadonlyArray<DraftView> => ready(drafts, []),

  /** Accept AI drafts — these, or all (null) — into the reader's review: they
   *  show as pending in it at once, with the words as edited. */
  accept: action(function* (ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>> = {}) {
    const chosen = ready(drafts, []).filter((d) => ids === null || ids.includes(d.id));
    setDrafts((l) => l.filter((d) => !chosen.includes(d)));
    setPending((l) => [...l, ...chosen.map((d) => ({ ...d, body: edits[d.id] ?? d.body, drafted: true as const }))]);
    const r = (yield acceptDrafts(ticketId, ids, edits)) as DraftsResult;
    note(chosen.map((d) => d.id), r.failed);
    if (talk) refresh(talk);
    return r;
  }),
  /** Why a draft or a pending comment could not be taken the last time, if it could not. */
  refusal: (id: string): string | undefined => refusals()[id],
  /** Decline AI drafts — these, or all (null): gone at once, said nowhere. */
  decline: action(function* (ids: ReadonlyArray<string> | null) {
    setDrafts((l) => l.filter((d) => ids !== null && !ids.includes(d.id)));
    yield dropDrafts(ticketId, ids, "ai");
    if (talk) refresh(talk);
  }),

  /** The comments pending in the reader's review, and those on one line. */
  pending: (): ReadonlyArray<DraftView> => ready(pending, []),
  pendingAt: (file: string, side: "LEFT" | "RIGHT", line: number): ReadonlyArray<DraftView> => {
    const at = spot(file, side, line);
    return ready(pending, []).filter((d) => spot(d.file, d.side, d.line) === at);
  },
  /** A comment into the reader's review, pending until they finish it — shown at once. */
  addToReview: action(function* (file: string, side: "LEFT" | "RIGHT", line: number, body: string, start: { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null) {
    const commit = diffNow.commit();
    if (!commit) return { error: "The page does not know which commit its diff is." } as HostWrite;
    setPending((l) => [...l, { id: `new-${Date.now()}`, file, line, side, ...(start ? { startLine: start.line, startSide: start.side } : {}), body }]);
    const r = (yield addToReview(ticketId, file, line, side, body, commit, start)) as HostWrite;
    if (talk) refresh(talk);
    return r;
  }),
  /** New words for a pending comment (or a draft), shown at once. */
  edit: action(function* (id: string, body: string) {
    setPending((l) => l.map((d) => (d.id === id ? { ...d, body } : d)));
    setDrafts((l) => l.map((d) => (d.id === id ? { ...d, body } : d)));
    const r = (yield editDraft(ticketId, id, body)) as DraftsResult;
    note([id], r.failed);
    if (talk) refresh(talk);
    return r;
  }),
  /** Take comments out of the reader's review — these, or all (null). */
  unpend: action(function* (ids: ReadonlyArray<string> | null) {
    setPending((l) => l.filter((d) => ids !== null && !ids.includes(d.id)));
    yield dropDrafts(ticketId, ids, "pending");
    if (talk) refresh(talk);
  }),
  /** Finish the review: a verdict, words, and every pending comment, said at
   *  once — each shows as on its way until the host and the room have it;
   *  a refusal leaves the review pending, all of it. */
  submit: action(function* (verdict: Verdict, body: string) {
    const me = hostNow.host()?.viewer;
    const going = ready(pending, []);
    setPending(() => []);
    setComments((l) => [...l, ...going.map((d): LineComment => ({ id: `sending-${d.id}`, author: me ?? { login: "you" }, body: d.body, file: d.file, line: d.line, side: d.side, ...(d.startLine !== undefined ? { startLine: d.startLine, startSide: d.startSide ?? d.side } : {}), url: "", at: new Date().toISOString(), pending: true, ...(d.drafted ? { drafted: true as const } : {}) }))]);
    const r = (yield submitReview(ticketId, verdict, body, diffNow.commit() ?? null)) as SubmitResult;
    if (talk) refresh(talk);
    if ("ok" in r && view) refresh(view);
    return r;
  }),

  /** The comments on one line, the reader's own on its way among them. */
  commentsAt: (file: string, side: "LEFT" | "RIGHT", line: number): ReadonlyArray<LineComment> => {
    const at = spot(file, side, line);
    return ready(comments, []).filter((c) => spot(c.file, c.side, c.line) === at);
  },

  /** The lines picked for a comment, and whether the pointer is still dragging them out. */
  pick,
  dragging,
  /** The pointer went down on a line's +: a new pick there — or, with shift
   *  held, the pick in this hunk stretched to it. Dragging goes on until the
   *  button comes up, anywhere. */
  startPick: (hunk: string, row: number, stretch: boolean): void => {
    const p = pick();
    setPick(stretch && p?.hunk === hunk ? { ...p, focus: row } : { hunk, anchor: row, focus: row });
    setDragging(true);
    window.addEventListener("mouseup", () => setDragging(false), { once: true });
  },
  /** The pointer passed over a line while dragging: the pick reaches it. */
  dragTo: (hunk: string, row: number): void => {
    const p = pick();
    if (dragging() && p?.hunk === hunk && p.focus !== row) setPick({ ...p, focus: row });
  },
  clearPick: (): void => {
    setPick(null);
  },

  /** Post a single comment on a line, or a block of lines from `start`, at
   *  the commit the page shows — apart from the review (GitHub's "Add single
   *  comment"). It shows at once as the reader's, marked as on
   *  its way; the host's answer (read again) takes its place, or a refusal
   *  takes it away. */
  comment: action(function* (file: string, side: "LEFT" | "RIGHT", line: number, body: string, start: { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null) {
    const commit = diffNow.commit();
    if (!commit) return { error: "The page does not know which commit its diff is." } as HostWrite;
    const me = hostNow.host()?.viewer;
    const mine: LineComment = { id: `pending-${Date.now()}`, author: me ?? { login: "you" }, body, file, line, side, ...(start ? { startLine: start.line, startSide: start.side } : {}), url: "", at: new Date().toISOString(), pending: true };
    setComments((l) => [...l, mine]);
    const said = (yield sendLineComment(ticketId, file, line, side, body, commit, start)) as HostWrite;
    if ("ok" in said) {
      if (talk) refresh(talk);
      if (view) refresh(view);
    }
    return said;
  }),

};

/** Keep why each of `ids` could not be taken, and forget it for the rest. */
function note(ids: ReadonlyArray<string>, failed: ReadonlyArray<{ readonly id: string; readonly error: string }>): void {
  setRefusals((r) => ({ ...Object.fromEntries(Object.entries(r).filter(([id]) => !ids.includes(id))), ...Object.fromEntries(failed.map((f) => [f.id, f.error])) }));
}
