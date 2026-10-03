import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import type { ScrollBoxProps } from "@opentui/react";
import { followTop, type Follow, type View } from "../lib/followScroll";

/** What a list keeps in view: a row (by the id it is drawn under), moved
 *  only at the edges or put at the top; or the list's start or end. Null:
 *  nothing — the list stays where it is (scrolled by hand). */
export type FollowWhat = { readonly id: string; readonly how?: "edge" | "top" } | "start" | "end" | null;

/** Scrolling by hand, for a list read line by line (an opened record). */
export interface FollowScrollHandle {
  /** move the first visible line by `lines`, within the list */
  readonly scrollBy: (lines: number) => void;
  /** put the first visible line at `top`, within the list */
  readonly scrollTo: (top: number) => void;
  /** where the list stands: its first visible line, how many show, how many it has */
  readonly view: () => View;
}

type Props = Omit<ScrollBoxProps, "children" | "ref" | "onSizeChange"> & {
  readonly follow: FollowWhat;
  /** the list's width as laid out, when it changes (for wrapping text to it) */
  readonly onWidth?: (width: number) => void;
  /** where the list stands, whenever that changes (for "12/40") */
  readonly onView?: (view: View) => void;
  readonly children: ReactNode;
};

const viewOf = (list: ScrollBoxRenderable): View => ({ top: list.scrollTop, height: list.viewport.height, total: list.content.height });

/** Where to keep `what` in view, measured inside the list's content — which
 *  does not move as it scrolls. (OpenTUI's own scrollChildIntoView measured
 *  the row on screen against a viewport whose position drifted once the list
 *  had scrolled: it moved early, and lost the cursor.) */
const keep = (list: ScrollBoxRenderable, what: FollowWhat): void => {
  if (what === null) return;
  let follow: Follow;
  if (what === "start") follow = { kind: "start" };
  else if (what === "end") follow = { kind: "end" };
  else {
    const row: Renderable | undefined = list.content.findDescendantById(what.id);
    if (!row) return;
    const at = row.y - list.content.y;
    follow = what.how === "top" ? { kind: "top", at } : { kind: "edge", at, size: row.height };
  }
  const top = followTop(viewOf(list), follow);
  if (top !== list.scrollTop) list.scrollTop = top;
};

/** A list that scrolls inside its box and keeps its cursor in view — every
 *  scrolling list in the TUI is one, so they all move alike: not while the
 *  cursor's row is in view; down only when it would fall below the bottom,
 *  up only when it would rise above the top, by exactly enough to bring it
 *  to that edge (lib/followScroll). It follows again whenever the rows move
 *  under the cursor — a fold, rows arriving or leaving above, a resize —
 *  once they are laid out, by chaining onto the scrollbox's own size
 *  handlers (never replacing them: it re-measures its range there). Rows are
 *  found by their `id`. */
export const FollowScroll = forwardRef<FollowScrollHandle, Props>(function FollowScroll({ follow, onWidth, onView, children, ...box }, ref) {
  const list = useRef<ScrollBoxRenderable>(null);
  const want = useRef<FollowWhat>(follow);
  want.current = follow;
  const width = useRef<number | null>(null);
  const told = useRef("");
  const tell = () => {
    const l = list.current;
    if (!l || !onView) return;
    const v = viewOf(l);
    const key = `${v.top}|${v.height}|${v.total}`;
    if (key !== told.current) {
      told.current = key;
      onView(v);
    }
  };
  const followNow = () => {
    if (list.current) keep(list.current, want.current);
    tell();
  };

  const followKey = follow === null || typeof follow === "string" ? String(follow) : `${follow.id}|${follow.how ?? "edge"}`;
  useEffect(followNow, [followKey]);
  useEffect(() => {
    const l = list.current;
    if (!l) return;
    const undo = [l.content, l.viewport].map((part) => {
      const before = part.onSizeChange;
      part.onSizeChange = function (this: typeof part) {
        before?.call(this);
        followNow();
      };
      return () => {
        part.onSizeChange = before;
      };
    });
    return () => undo.forEach((f) => f());
  });

  useImperativeHandle(ref, () => ({
    scrollBy: (lines) => {
      const l = list.current;
      if (l) l.scrollTop = followTop(viewOf(l), { kind: "top", at: l.scrollTop + lines });
      tell();
    },
    scrollTo: (top) => {
      const l = list.current;
      if (l) l.scrollTop = followTop(viewOf(l), { kind: "top", at: top });
      tell();
    },
    view: () => (list.current ? viewOf(list.current) : { top: 0, height: 0, total: 0 }),
  }));

  return (
    <scrollbox
      ref={list}
      scrollbarOptions={{ visible: false }}
      flexShrink={1}
      minHeight={0}
      {...box}
      onSizeChange={function (this: { width: number }) {
        if (onWidth && this.width !== width.current) {
          width.current = this.width;
          onWidth(this.width);
        }
        followNow();
      }}
    >
      {children}
    </scrollbox>
  );
});
