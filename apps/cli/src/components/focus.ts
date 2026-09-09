import { Atom } from "effect/unstable/reactivity";

// Keyboard focus for a TUI: exactly one Focusable is hovered at a time, and
// arrow keys move between Focusables by WHERE THEY ARE ON SCREEN — the layout
// engine is the source of truth, so a component never knows or cares what
// sits next to it. Plain client-side atoms — no runtime, no context.

/** Id of the hovered Focusable ("" = nothing hovered). */
export const focusAtom = Atom.make<string>("");

/** While a Focusable has taken the keyboard over (a picker, a form), this is
 *  its hint; every other key handler stands down until it is null again. */
export const captureAtom = Atom.make<string | null>(null);

/** What ← does when a section leaves it alone and nothing (or only the rooms
 *  rail) lies to the left: a page installs "go back" here, so ← means back
 *  everywhere on the page instead of jumping to the rail. Null on the tabs. */
export const leftEdgeAtom = Atom.make<(() => void) | null>(null);

/** Hint text per Focusable id, registered by the Focusables themselves — a
 *  footer can show the hovered one's without knowing the sections exist. */
export const hintsAtom = Atom.make<Readonly<Record<string, string>>>({});

export type Direction = "up" | "down" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Mounted Focusables report their on-screen bounds lazily (layout runs after
// render), so navigation always measures the current frame.
const bounds = new Map<string, () => Rect | null>();

export function registerFocusable(id: string, getRect: () => Rect | null): () => void {
  bounds.set(id, getRect);
  return () => {
    if (bounds.get(id) === getRect) bounds.delete(id);
  };
}

/** Distance from a point to an interval (0 when inside). */
const gap = (p: number, lo: number, hi: number) => (p < lo ? lo - p : p > hi ? p - hi : 0);

/** The nearest Focusable in a direction, judged from the hovered one's rect.
 *  Primary axis: how far past our edge the candidate starts. Secondary: how
 *  far the candidate's span is from our leading corner (top-left) — so from a
 *  full-width tab bar, ↓ lands on the section under the cursor, not the one
 *  that happens to start a row higher. */
export function nearestFocusable(fromId: string, dir: Direction): string | null {
  const from = bounds.get(fromId)?.();
  if (!from) return null;
  let best: { id: string; score: number } | null = null;
  for (const [id, get] of bounds) {
    if (id === fromId) continue;
    const r = get();
    if (!r) continue;
    let primary: number;
    let secondary: number;
    switch (dir) {
      case "right":
        primary = r.x - (from.x + from.width);
        secondary = gap(from.y, r.y, r.y + r.height - 1);
        break;
      case "left":
        primary = from.x - (r.x + r.width);
        secondary = gap(from.y, r.y, r.y + r.height - 1);
        break;
      case "down":
        primary = r.y - (from.y + from.height);
        secondary = gap(from.x, r.x, r.x + r.width - 1);
        break;
      case "up":
        primary = from.y - (r.y + r.height);
        secondary = gap(from.x, r.x, r.x + r.width - 1);
        break;
    }
    // must actually lie in that direction (touching edges count)
    if (primary < 0) continue;
    const score = primary + 3 * secondary;
    if (best === null || score < best.score) best = { id, score };
  }
  return best?.id ?? null;
}
