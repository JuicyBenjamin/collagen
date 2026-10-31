import type { LocalState, ViewedMark } from "@collagen/p2p";

// The person's viewed marks, kept in their own collagen: the review page's,
// and their agent's (review-progress). Theirs alone, never broadcast.

/** Reviews kept at most: the oldest marked goes first. */
const KEPT = 300;

/** A review's marks, file → mark. */
export const marksOf = (state: Pick<LocalState, "viewed">, ticketId: string): Readonly<Record<string, ViewedMark>> => state.viewed?.[ticketId] ?? {};

/** The state with a file's mark set, or (null) taken back. A review marked
 *  last moves to the end, so the oldest are the ones let go. */
export const withViewed = <S extends Pick<LocalState, "viewed">>(state: S, ticketId: string, file: string, mark: ViewedMark | null): S => {
  const { [file]: _gone, ...rest } = marksOf(state, ticketId);
  const marks = mark ? { ...rest, [file]: mark } : rest;
  const { [ticketId]: _was, ...others } = state.viewed ?? {};
  const kept = Object.entries(Object.keys(marks).length > 0 ? { ...others, [ticketId]: marks } : others).slice(-KEPT);
  return { ...state, viewed: Object.fromEntries(kept) };
};
