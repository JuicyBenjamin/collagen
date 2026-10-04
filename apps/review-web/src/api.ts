import { GET, live } from "@solidjs/web/server-functions";
import type { DefinitionResult, DraftsResult, Finish, HostView, HostWrite, HoverResult, ReviewPageData, SinceResult, SubmitResult, TalkView, ToolId, ToolState, Verdict, WholeFileResult } from "./data";
import { run, stream } from "./server/backend";

// The page's server functions: called on the page like any function, run in
// the collagen instance on its own services (server/backend). Reads are
// GETs, so Solid can cache and refresh them; installing a tool is the one
// write. Nothing else goes between the page and the instance.

export const reviewData = GET(async (ticketId: string): Promise<ReviewPageData | null> => {
  "use server";
  return run((b) => b.data(ticketId));
});

/** The review's state as a token, current first and again whenever it
 *  moves: the page reads its data again when the token differs from the
 *  last it saw. Held open while the page is. */
export const reviewChanges = live(
  GET(async (ticketId: string): Promise<AsyncIterable<string>> => {
    "use server";
    return stream((b) => b.changes(ticketId));
  }),
);

/** Types and peeks are of the code at the commit the page shows — the same
 *  code the reader is pointing at, even after the branch has moved on. */
export const hoverAt = GET(async (ticketId: string, file: string, line: number, col: number, commit: string): Promise<HoverResult> => {
  "use server";
  return run((b) => b.hover(ticketId, file, line, col, commit));
});

export const definitionAt = GET(async (ticketId: string, file: string, line: number, col: number, commit: string): Promise<DefinitionResult> => {
  "use server";
  return run((b) => b.definition(ticketId, file, line, col, commit));
});

/** A language server's state, live: the offer, its install, its notices
 *  follow it as it moves. Held open while the page is. */
export const toolStates = live(
  GET(async (tool: ToolId): Promise<AsyncIterable<ToolState>> => {
    "use server";
    return stream((b) => b.tool(tool));
  }),
);

/** Install a language server — only ever on the reader's click. */
export const installTool = async (tool: ToolId): Promise<ToolState | null> => {
  "use server";
  return run((b) => b.install(tool));
};

/** A file whole at the commit the page shows: its added-line marks and its
 *  scroll target come from that commit's diff, so the file must be that
 *  commit's too — even when the branch has moved since. */
export const wholeFile = GET(async (ticketId: string, file: string, commit: string): Promise<WholeFileResult> => {
  "use server";
  return run((b) => b.wholeFile(ticketId, file, commit));
});

/** What moved in a file from the commit it was viewed at to the commit the
 *  page shows — exactly those two, so the changes sit where the page's hunks are. */
export const sinceViewed = GET(async (ticketId: string, file: string, from: string, to: string): Promise<SinceResult> => {
  "use server";
  return run((b) => b.since(ticketId, file, from, to));
});

/** The review on its host — a call of its own, so the diff never waits on
 *  the network: who is signed in, its pull request, its line comments, the
 *  stack its branch sits in. Read again as the review's state moves. */
export const hostView = GET(async (ticketId: string): Promise<HostView> => {
  "use server";
  return run((b) => b.host(ticketId));
});

/** Finish the reader's review — only ever on their click: its pending
 *  comments said, on the pull request as one review with their verdict and
 *  words, and in the room. Not a read: Solid refuses it from any page but
 *  this one. */
export const submitReview = async (ticketId: string, verdict: Verdict, body: string, commit: string | null, shownAs: string | null, seen: Finish): Promise<SubmitResult> => {
  "use server";
  return run((b) => b.submit(ticketId, verdict, body, commit, shownAs, seen));
};

/** A single comment on a line — or a block of lines, from `start` to `line`
 *  — at the commit the page shows, said at once (GitHub's "Add single
 *  comment"): in the room as the reader's, and on the pull request too when
 *  there is an open one. */
export const sendLineComment = async (
  ticketId: string,
  file: string,
  line: number,
  side: "LEFT" | "RIGHT",
  body: string,
  commit: string,
  start: { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null,
  shownAs: string | null,
): Promise<HostWrite> => {
  "use server";
  return run((b) => b.lineComment(ticketId, file, line, side, body, commit, start, shownAs));
};

/** The comments on the review collagen holds: what the reader's AI drafted
 *  (waiting on them, this machine's own) and what has been said in the room.
 *  Read again as the review's state moves — a new draft moves it. */
export const talkView = GET(async (ticketId: string): Promise<TalkView> => {
  "use server";
  return run((b) => b.talk(ticketId));
});

/** A comment into the reader's review: pending, said when they finish it. */
export const addToReview = async (
  ticketId: string,
  file: string,
  line: number,
  side: "LEFT" | "RIGHT",
  body: string,
  commit: string,
  start: { readonly line: number; readonly side: "LEFT" | "RIGHT" } | null,
): Promise<HostWrite> => {
  "use server";
  return run((b) => b.addToReview(ticketId, file, line, side, body, commit, start));
};

/** Accept the AI's drafts — by id, or all (null) — into the reader's review;
 *  `edits` holds words the reader changed. */
export const acceptDrafts = async (ticketId: string, ids: ReadonlyArray<string> | null, edits: Readonly<Record<string, string>>): Promise<DraftsResult> => {
  "use server";
  return run((b) => b.accept(ticketId, ids, edits));
};

/** New words for a draft or a pending comment. */
export const editDraft = async (ticketId: string, id: string, body: string): Promise<DraftsResult> => {
  "use server";
  return run((b) => b.edit(ticketId, id, body));
};

/** Drop drafts or pending comments — by id; or, with null, every one of a
 *  kind: the AI's ("ai") or the review's ("pending"). */
export const dropDrafts = async (ticketId: string, ids: ReadonlyArray<string> | null, kind: "ai" | "pending"): Promise<number> => {
  "use server";
  return run((b) => b.drop(ticketId, ids, kind));
};

/** Confirm where a comment not said yet sits, at the commit the page shows
 *  now — after the branch moved under it. */
export const repinDraft = async (ticketId: string, id: string, commit: string): Promise<DraftsResult> => {
  "use server";
  return run((b) => b.repin(ticketId, id, commit));
};
