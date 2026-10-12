import { animate } from "motion";

// A part of the page fading up as it arrives, in place of the empty shape
// it replaces — once: while a part is first being filled in. Read again as
// the review moves, it changes in place without moving. Short and small,
// and none at all when the reader asks their system for less motion.

const EASE = [0.22, 1, 0.36, 1] as const;
const still = matchMedia("(prefers-reduced-motion: reduce)");
/** How long after its first entrance an area still animates what arrives (ms). */
const WHILE_BUILDING = 1500;
/** The most a later one waits behind the first, so a long list does not trail on. */
const STAGGER = 0.04;
const LONGEST = 5;
/** Frames a part is waited on to reach the page — one that waits on its data is made first and shown later. */
const FRAMES_TO_SHOW = 600;

/** Run `then` on a painted frame of a loaded page. An animation begun while the
 *  page is still loading is lost. */
const afterLoad = (then: () => void): void => {
  const frame = () => requestAnimationFrame(() => requestAnimationFrame(then));
  if (document.readyState === "complete") frame();
  else addEventListener("load", frame, { once: true });
};

/** One area of the page's entrance: call it with each part as it is made,
 *  and its place in the list (parts of one list follow each other a beat apart). */
export function entering(): (element: HTMLElement, place?: number) => void {
  let first: number | null = null;
  const late = () => first !== null && performance.now() - first > WHILE_BUILDING;
  return (element, place = 0) => {
    // the area is built: what comes now is a change, shown as it is
    if (still.matches || late()) return;
    element.classList.add("entering");
    const done = () => {
      // nothing left behind: a transform would hold every sticky and fixed thing inside it
      element.classList.remove("entering");
      element.style.removeProperty("opacity");
      element.style.removeProperty("transform");
    };
    let waited = 0;
    const when = () => {
      // not on the page yet: wait for it; one that takes too long is shown as it is
      if (!element.isConnected) {
        if (++waited < FRAMES_TO_SHOW) requestAnimationFrame(when);
        else done();
        return;
      }
      first ??= performance.now();
      if (late()) return done();
      void animate(element, { opacity: [0, 1], y: [6, 0] }, { duration: 0.28, ease: EASE, delay: Math.min(place, LONGEST) * STAGGER }).then(done);
    };
    afterLoad(when);
  };
}
