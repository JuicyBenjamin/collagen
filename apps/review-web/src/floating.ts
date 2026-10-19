import { createSignal, flush } from "solid-js";

/** Whether the header's progress has scrolled out of sight: then the count,
 *  and the buttons that finish the review, float in the corner instead. */
export const [floating, setFloatingNow] = createSignal(false);

const still = matchMedia("(prefers-reduced-motion: reduce)");
/** Can the pill fly between the header and the corner (a view transition). */
export const flies = typeof document !== "undefined" && "startViewTransition" in document;

/** Where the pill is going while a transition's switch is yet to run. */
let heading: boolean | null = null;

/** The pill moves to the corner or back: as one view transition, so it flies
 *  from where it was to where it goes (styles.css: review-pill) — or at once
 *  when the browser has none, the tab is out of sight, or less motion is asked. */
export function setFloating(next: boolean): void {
  // where it is going, while a transition's switch is yet to run: a fast
  // scroll asks again before then, and must not start it twice
  if (next === (heading ?? floating())) return;
  if (!flies || still.matches || document.hidden) {
    heading = null;
    return void setFloatingNow(next);
  }
  heading = next;
  document.startViewTransition(() => {
    heading = null;
    setFloatingNow(next);
    flush();
  });
}

/** How far past the top of the window the header's pill goes before it
 *  floats, and how far back into view its place comes before it returns
 *  (px): a distance, not a delay, so a fast scroll is answered at once. */
const PAST = 96;
const BACK = 24;

/** Follow the header's pill as the page scrolls: it floats once it is well
 *  past the top, and comes back once its place is well in view — never on
 *  the very pixel it leaves or arrives, so it does not move like a switch,
 *  and the two lines apart, so it does not bounce between them. Gives back
 *  what stops it. */
export function followPill(element: HTMLElement): () => void {
  // on each scroll, not on a frame: a page out of sight draws none
  const check = () => {
    const rect = element.getBoundingClientRect();
    const now = heading ?? floating();
    const wanted = now ? rect.top < BACK : rect.bottom < -PAST;
    if (wanted !== now) setFloating(wanted);
  };
  addEventListener("scroll", check, { passive: true });
  addEventListener("resize", check, { passive: true });
  check();
  return () => {
    removeEventListener("scroll", check);
    removeEventListener("resize", check);
  };
}
