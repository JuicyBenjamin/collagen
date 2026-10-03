import { action, createMemo, createOptimistic, createSignal, NotReadyError, refresh, type Accessor, type SourceAccessor } from "solid-js";
import { hostView, sendLineComment, sendReview } from "./api";
import type { HostView, HostWrite, LineComment, Verdict } from "./data";
import { diffNow } from "./diffNow";
import { ticketId } from "./ticket";

// The review on its host (GitHub), as the page holds it: read once the page
// is up and again whenever the review's state moves, and never in the way of
// the diff — GitHub is a network away, so a part not read yet reads as
// nothing here instead of holding the page (`ready`). Line comments are
// optimistic: the reader's own shows under its line at once, and stays until
// the host's answer replaces it — or goes, with the reason, if it refused.

type Host = Extract<HostView, { readonly host: string }>;

let view: SourceAccessor<HostView> | null = null;
let comments: Accessor<ReadonlyArray<LineComment>> = () => [];
let setComments: (f: (l: ReadonlyArray<LineComment>) => ReadonlyArray<LineComment>) => void = () => {};

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
const [dragging, setDragging] = createSignal(false);

export const hostNow = {
  /** Made once by the page, read again each time `state` (the review's live token) moves. */
  start(state: Accessor<unknown>): void {
    const v = createMemo(() => {
      state();
      return hostView(ticketId);
    });
    view = v;
    const [list, set] = createOptimistic(() => {
      const h = v();
      return "host" in h ? h.comments : [];
    });
    comments = list;
    setComments = set;
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

  /** Can the reader act on the pull request from here: signed in, and it is open. */
  canWrite: (): boolean => {
    const h = hostNow.host();
    return h !== null && h.viewer !== null && h.pull?.state === "open";
  },

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
    const mine: LineComment = { id: -Date.now(), author: me ?? { login: "you" }, body, file, line, side, ...(start ? { startLine: start.line, startSide: start.side } : {}), url: "", at: new Date().toISOString(), pending: true };
    setComments((l) => [...l, mine]);
    const said = (yield sendLineComment(ticketId, file, line, side, body, commit, start)) as HostWrite;
    if ("ok" in said && view) refresh(view);
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
