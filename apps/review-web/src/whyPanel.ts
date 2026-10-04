import { animate } from "motion";

// The why beside a unit opens and folds in place: on a wide window it is a
// column on the right that grows from nothing — across, as the code eases
// narrower, and down, so folded it holds no height open beneath a short
// unit — its reasons sliding in from that side; on a narrow one it unfolds
// down under the unit's head. Animated with Motion — none at all when the reader
// asks their system for less motion.

/** How wide the why's column is open. */
export const WHY_WIDTH = 280;
/** The space under it on a narrow window. */
const WHY_BELOW = 14;

const EASE = [0.22, 1, 0.36, 1] as const;
const still = matchMedia("(prefers-reduced-motion: reduce)");

/** Bring the panel to `open` on the window's layout (`wide`): moved, unless `instant`. */
export async function placeWhy(panel: HTMLElement, inner: HTMLElement, open: boolean, wide: boolean, instant: boolean): Promise<void> {
  const duration = instant || still.matches ? 0 : 0.32;
  panel.inert = !open;
  if (open) panel.style.visibility = "visible";
  // the other layout's measures go: a resize across the line starts clean
  if (wide) {
    panel.style.marginBottom = "";
  } else {
    panel.style.width = "";
  }
  const reasons = animate(inner, { opacity: open ? 1 : 0, x: open || !wide ? 0 : 16, y: open || wide ? 0 : -6 }, { duration: open ? duration : duration * 0.6, ease: EASE, delay: open ? duration * 0.25 : 0 });
  const box = wide
    ? animate(panel, { width: open ? WHY_WIDTH : 0, height: open ? inner.offsetHeight : 0 }, { duration, ease: EASE })
    : animate(panel, { height: open ? inner.offsetHeight : 0, marginBottom: open ? WHY_BELOW : 0 }, { duration, ease: EASE });
  await Promise.all([box, reasons]);
  // open, it follows its content's height from here on
  if (open) panel.style.height = "auto";
  if (!open) panel.style.visibility = "hidden";
}

/** How long opening takes — what a jump to a reason inside waits for. */
export const whyOpening = (): number => (still.matches ? 0 : 340);
