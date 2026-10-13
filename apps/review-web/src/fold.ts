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
