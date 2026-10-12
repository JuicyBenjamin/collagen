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

/** How tall the panel can grow on a wide window: its rail is as tall as the
 *  window at most (styles.css), less the toggle above the panel — a longer
 *  why scrolls inside it, so opening grows only to that. */
const room = (panel: HTMLElement): number => {
  const rail = panel.parentElement;
  const most = rail ? parseFloat(getComputedStyle(rail).maxHeight) : NaN;
  if (!rail || Number.isNaN(most)) return Infinity;
  return Math.max(0, most - (panel.getBoundingClientRect().top - rail.getBoundingClientRect().top));
};

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
    ? animate(panel, { width: open ? WHY_WIDTH : 0, height: open ? Math.min(inner.offsetHeight, room(panel)) : 0 }, { duration, ease: EASE })
    : animate(panel, { height: open ? inner.offsetHeight : 0, marginBottom: open ? WHY_BELOW : 0 }, { duration, ease: EASE });
  await Promise.all([box, reasons]);
  // open, it follows its content's height from here on
  if (open) panel.style.height = "auto";
  if (!open) panel.style.visibility = "hidden";
}

/** Marks which ends of a scrolling why have more beyond them — `data-above`,
 *  `data-below` — so styles.css softens those edges as the top of the page
 *  does. Kept up on scroll and whenever the panel or its reasons change size;
 *  lets go once the panel leaves the page. */
export function keepEdges(panel: HTMLElement): void {
  const mark = () => {
    const below = panel.scrollHeight - panel.clientHeight - panel.scrollTop;
    panel.toggleAttribute("data-above", panel.scrollTop > 1);
    panel.toggleAttribute("data-below", below > 1);
  };
  // it is made before it is placed: only a panel that was on the page and left it is done
  let placed = false;
  const sizes = new ResizeObserver(() => {
    if (panel.isConnected) placed = true;
    else if (placed) return sizes.disconnect();
    mark();
  });
  sizes.observe(panel);
  if (panel.firstElementChild) sizes.observe(panel.firstElementChild);
  panel.addEventListener("scroll", mark, { passive: true });
}

/** How long opening takes — what a jump to a reason inside waits for. */
export const whyOpening = (): number => (still.matches ? 0 : 340);
