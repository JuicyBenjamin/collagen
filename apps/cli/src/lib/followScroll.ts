import { clamp } from "./math";

// Where a scrolling list should sit so its cursor stays in view — the pure
// half of components/FollowScroll. One rule for every list in the TUI: the
// list does not move while the cursor's row is in view; it scrolls down only
// when that row would fall below the bottom, up only when it would rise
// above the top, and then by exactly enough to bring it to that edge. A list
// that moved on every keypress (centring the cursor) read as jumping.

/** The list as it stands: its first visible line, how many lines show, how
 *  many it has in all. */
export interface View {
  readonly top: number;
  readonly height: number;
  readonly total: number;
}

/** What the list keeps in view:
 *    edge  — a row at `at`, `size` lines tall: moved only at the edges
 *    top   — a row at `at`, put at the top (a record opened to read down from)
 *    start — the very top (the first row: what heads the list shows)
 *    end   — the very bottom (following the newest) */
export type Follow = { readonly kind: "edge"; readonly at: number; readonly size: number } | { readonly kind: "top"; readonly at: number } | { readonly kind: "start" } | { readonly kind: "end" };

/** The first visible line that keeps `follow` in view, moving as little as
 *  the rule allows; never past either end. */
export const followTop = (view: View, follow: Follow): number => {
  const last = Math.max(0, view.total - view.height);
  switch (follow.kind) {
    case "start":
      return 0;
    case "end":
      return last;
    case "top":
      return clamp(follow.at, 0, last);
    case "edge": {
      if (follow.at < view.top) return clamp(follow.at, 0, last);
      if (follow.at + follow.size > view.top + view.height) return clamp(follow.at + follow.size - view.height, 0, last);
      return clamp(view.top, 0, last);
    }
  }
};
