import { action, createMemo, createOptimistic, createSignal, NotReadyError, refresh, type Accessor, type SourceAccessor } from "solid-js";
import { acceptDrafts, declineDrafts, hostView, sendLineComment, sendReview, talkView } from "./api";
import type { AcceptResult, DraftView, HostView, HostWrite, LineComment, TalkView, Verdict } from "./data";
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

  /** Accept drafts — these, or all (null) — said as the reader's: each shows
   *  as theirs at once, on its way, until the room and the host have it. */
  accept: action(function* (ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>> = {}) {
    const me = hostNow.host()?.viewer;
    const chosen = ready(drafts, []).filter((d) => ids === null || ids.includes(d.id));
    setDrafts((l) => l.filter((d) => !chosen.includes(d)));
    setComments((l) => [...l, ...chosen.map((d): LineComment => ({ id: `pending-${d.id}`, author: me ?? { login: "you" }, body: edits[d.id] ?? d.body, file: d.file, line: d.line, side: d.side, ...(d.startLine !== undefined ? { startLine: d.startLine, startSide: d.startSide ?? d.side } : {}), url: "", at: new Date().toISOString(), pending: true, drafted: true }))]);
    const said = (yield acceptDrafts(ticketId, ids, edits)) as AcceptResult;
    setRefusals((r) => ({ ...Object.fromEntries(Object.entries(r).filter(([id]) => !chosen.some((d) => d.id === id))), ...Object.fromEntries(said.failed.map((f) => [f.id, f.error])) }));
    if (talk) refresh(talk);
    if (said.said > 0 && view) refresh(view);
    return said;
  }),
  /** Why a draft could not be said the last time it was accepted, if it could not. */
  refusal: (id: string): string | undefined => refusals()[id],
  /** Decline drafts — these, or all (null): gone at once, said nowhere. */
  decline: action(function* (ids: ReadonlyArray<string> | null) {
    setDrafts((l) => l.filter((d) => ids !== null && !ids.includes(d.id)));
    yield declineDrafts(ticketId, ids);
    if (talk) refresh(talk);
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

  /** Post a comment on a line, or a block of lines from `start`, at the
   *  commit the page shows. It shows at once as the reader's, marked as on
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

  /** Send a review — a comment, an approval or a request for changes — and
   *  read the pull request again for its new decision. */
  review: action(function* (verdict: Verdict, body: string) {
    const said = (yield sendReview(ticketId, verdict, body)) as HostWrite;
    if ("ok" in said && view) refresh(view);
    return said;
  }),
};
