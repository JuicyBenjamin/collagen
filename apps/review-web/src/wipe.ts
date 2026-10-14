import { createSignal, type Accessor } from "solid-js";

// A part of the page arriving: its placeholder (the same markup, its words
// masked) stays under it and the part sweeps in over it from the top left
// to the bottom right — each part on its own, as soon as it is read, so a
// slow part never holds back a fast one. Once: later reads change in place.
// None at all when the reader asks their system for less motion.

const still = matchMedia("(prefers-reduced-motion: reduce)");
/** As long as the sweep runs (styles.css: wipe-in). */
const SWEEP_MS = 550;

/** One part's sweep: `under` holds its placeholder in place while it runs;
 *  `start` goes on the part itself as it is placed (its ref). */
export function wipeIn(): { readonly under: Accessor<boolean>; readonly start: (element: HTMLElement) => void } {
  const [under, setUnder] = createSignal(false);
  let started = false;
  const start = (element: HTMLElement) => {
    if (started || still.matches) return;
    started = true;
    setUnder(true);
    element.classList.add("wiping");
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      element.classList.remove("wiping");
      setUnder(false);
    };
    element.addEventListener("animationend", (event) => event.target === element && end());
    // a tab out of sight runs no animation: it ends on time anyway
    setTimeout(end, SWEEP_MS + 150);
  };
  return { under, start };
}
