import { animate } from "motion";

// A file folding to its header — marked viewed, or folded again by its
// chevron — closes over a quarter of a second instead of vanishing, so what
// comes after it slides up rather than jumping. Animated with Motion, as the
// why beside it is; none at all when the reader asks their system for less.

const EASE = [0.22, 1, 0.36, 1] as const;
const still = matchMedia("(prefers-reduced-motion: reduce)");

/** Close what a file's card shows under its header — its first change's
 *  code and every later change of it — then resolve, for the fold itself. */
export async function foldAway(card: Element | null): Promise<void> {
  if (!card || still.matches) return;
  // a change is display: contents (no box to shrink): its first one's body, and every part of the later ones
  const parts = [...card.querySelectorAll<HTMLElement>(":scope > .hunk.continued > *, :scope > .hunk:not(.continued) > .hunk-body")];
  await Promise.all(
    parts.map((el) => {
      el.style.overflow = "hidden";
      return animate(el, { height: [el.offsetHeight, 0], opacity: [1, 0], marginTop: 0, marginBottom: 0 }, { duration: 0.24, ease: EASE });
    }),
  );
}

/** An animation's end — or, where no frames come to run it (a tab out of
 *  sight), soon after it should have ended, so nothing is left half open. */
const ended = (run: PromiseLike<unknown>, seconds: number): Promise<unknown> =>
  Promise.race([run, new Promise((done) => setTimeout(done, seconds * 1000 + 100))]);

/** Something opening, as it comes in: from nothing to its own height, fading
 *  in. Call it on the element as it is placed (a ref); it starts closed. */
export function enter(el: HTMLElement): void {
  if (still.matches) return;
  el.style.overflow = "hidden";
  el.style.height = "0px";
  el.style.opacity = "0";
  // placed by the time the code that made it is done; measured then
  queueMicrotask(() => {
    void ended(animate(el, { height: [0, el.scrollHeight], opacity: [0, 1] }, { duration: 0.22, ease: EASE }).finished, 0.22).then(() => {
      for (const p of ["height", "opacity", "overflow"]) el.style.removeProperty(p);
    });
  });
}

/** Something closing: to nothing, fading out — resolves once it is gone, for
 *  the caller to take it away then. */
export async function leave(el: HTMLElement | undefined): Promise<void> {
  if (!el || still.matches) return;
  el.style.overflow = "hidden";
  await ended(animate(el, { height: [el.offsetHeight, 0], opacity: [1, 0] }, { duration: 0.2, ease: EASE }).finished, 0.2);
}
