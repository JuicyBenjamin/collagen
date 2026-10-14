import { createSignal, type Accessor } from "solid-js";

// A part of the page arriving: its placeholder (the same markup, its words
// masked) lies over it for a moment and is swept away from the top left to
// the bottom right — each part on its own, as soon as it is read, so a slow
// part never holds back a fast one. The placeholder is swept, not the part:
// it is about a screen tall, so the sweep is seen, where a part of thousands
// of lines would cross the screen in a blink. Once: later reads change in
// place. None at all when the reader asks their system for less motion.

const still = matchMedia("(prefers-reduced-motion: reduce)");
/** As long as the sweep runs (styles.css: swap-ghost). */
const SWEEP_MS = 600;
/** Frames a part is waited on to reach the page before it is shown as it is. */
const FRAMES_TO_SHOW = 600;

/** One part's sweep: `ghost` holds its placeholder over it while it runs;
 *  `start` goes on the part itself as it is placed (its ref). */
export function wipeIn(): { readonly ghost: Accessor<boolean>; readonly start: (element: HTMLElement) => void; readonly end: () => void } {
  const [ghost, setGhost] = createSignal(false);
  let started = false;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    setGhost(false);
  };
  const start = (element: HTMLElement) => {
    if (started || still.matches) return;
    started = true;
    // the placeholder is placed with the part, so the part never shows a
    // frame before it; its sweep (a CSS animation) starts as both reach the
    // page — a part is made while its data is still read, and shown after
    setGhost(true);
    let waited = 0;
    const begin = () => {
      if (!element.isConnected) {
        if (++waited < FRAMES_TO_SHOW) requestAnimationFrame(begin);
        else end();
        return;
      }
      // a tab out of sight runs no animation: it ends on time anyway
      setTimeout(end, SWEEP_MS + 150);
    };
    requestAnimationFrame(begin);
  };
  return { ghost, start, end };
}
