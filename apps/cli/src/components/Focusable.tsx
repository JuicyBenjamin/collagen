import { useEffect, useRef, type ReactNode } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useKeyboard, type BoxProps } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { captureAtom, focusAtom, hintsAtom, leftEdgeAtom, nearestFocusable, registerFocusable, type Direction } from "./focus";
import { keyDebug, type Key } from "./keys";

const DIRECTIONS: ReadonlySet<string> = new Set<Direction>(["up", "down", "left", "right"]);

type Box = Omit<BoxProps, "children" | "ref" | "id">;

/** A section the cursor can land on. It IS the box you'd otherwise render
 *  around your content (all box props pass through), so it knows its own
 *  place on screen. The section only decides what a key means while hovered
 *  and returns `true` to consume it; an arrow it leaves alone moves focus to
 *  whatever Focusable lies in that direction — worked out from the rendered
 *  layout, never configured. Move the component, and navigation follows.
 *
 *  `children` receives `focused` so the section can draw its own hover state. */
export function Focusable({
  id,
  hint,
  onKey,
  children,
  ...box
}: Box & {
  id: string;
  /** Shown in the footer while hovered. */
  hint: string;
  /** Return true to consume the key (stops spatial navigation). */
  onKey?: (key: Key) => boolean | void;
  children: (focused: boolean) => ReactNode;
}) {
  const ref = useRef<BoxRenderable>(null);
  const focused = useAtomValue(focusAtom) === id;
  const captured = useAtomValue(captureAtom) !== null;
  const setFocus = useAtomSet(focusAtom);
  const setHints = useAtomSet(hintsAtom);
  const leftEdge = useAtomValue(leftEdgeAtom);

  useEffect(
    () =>
      registerFocusable(id, () => {
        const r = ref.current;
        return r ? { x: r.screenX, y: r.screenY, width: r.width, height: r.height } : null;
      }),
    [id],
  );

  useEffect(() => {
    setHints((h) => ({ ...h, [id]: hint }));
    return () =>
      setHints((h) => {
        const { [id]: _gone, ...rest } = h;
        return rest;
      });
  }, [id, hint, setHints]);

  useKeyboard((key) => {
    if (!focused || captured) return;
    keyDebug(id, key);
    if (onKey?.(key) === true) return;
    if (!DIRECTIONS.has(key.name)) return;
    const to = nearestFocusable(id, key.name as Direction);
    // ← off the page's left edge (nothing there, or just the rooms rail) is "back"
    if (key.name === "left" && leftEdge !== null && (to === null || to === "rooms")) return leftEdge();
    if (to !== null) setFocus(to);
  });

  return (
    <box ref={ref} {...box}>
      {children(focused)}
    </box>
  );
}
