import { animate, cubicBezier } from "motion";

// A file folding to its header — marked viewed, or folded again by its
// chevron — closes over a quarter of a second instead of vanishing, so what
// comes after it slides up rather than jumping. Animated with Motion, as the
// why beside it is; none at all when the reader asks their system for less.

const EASE = [0.22, 1, 0.36, 1] as const;
/** How long a file's code takes to fold away: long enough to be seen
 *  closing, so marking it viewed reads as closing it, not as a jump. */
const FOLDS = 0.3;
const still = matchMedia("(prefers-reduced-motion: reduce)");

/** Close a file's card into its header: the card itself — its edge and
 *  corners — draws up to the header, the code inside fading as it is clipped,
 *  one box closing rather than a block shrinking under a header. What the
 *  reader cannot see (scrolled past above, still to come below) goes first,
 *  at once, the page shifted so nothing on screen moves: a long file closes
 *  where it can be seen, over the whole fold. Resolves with what puts the
 *  card back to its own size, for the caller to call once the folded file
 *  is drawn. */
export async function foldAway(card: Element | null): Promise<() => void> {
  if (!(card instanceof HTMLElement) || still.matches) return () => undefined;
  // a change is display: contents (no box to shrink): its first one's body, and every part of the later ones
  const parts = [...card.querySelectorAll<HTMLElement>(":scope > .hunk.continued > *, :scope > .hunk:not(.continued) > .hunk-body")];
  const head = card.querySelector<HTMLElement>(".file");
  // seen from under the file's header (stuck or not) to the window's foot
  const seenFrom = Math.max(0, head?.getBoundingClientRect().bottom ?? 0);
  let cutAbove = 0;
  for (const element of parts) {
    const box = element.getBoundingClientRect();
    const above = Math.min(box.height, Math.max(0, seenFrom - box.top));
    const below = Math.min(box.height - above, Math.max(0, box.bottom - innerHeight));
    cutAbove += above;
    element.style.overflow = "hidden";
    element.style.height = `${box.height - above - below}px`;
    // what was above stays scrolled out of the shortened box
    element.scrollTop = above;
  }
  if (cutAbove > 0) scrollBy({ top: -cutAbove, behavior: "instant" });
  // the card closes, down to its header alone
  const from = card.getBoundingClientRect().height;
  card.style.boxSizing = "border-box";
  card.style.height = `${from}px`;
  await Promise.all([
    ended(animate(card, { height: [from, head?.offsetHeight ?? 0] }, { duration: FOLDS, ease: EASE }).finished, FOLDS),
    ...parts.map((element) => ended(animate(element, { opacity: [1, 0] }, { duration: FOLDS, ease: EASE }).finished, FOLDS)),
  ]);
  return () => {
    for (const property of ["height", "box-sizing"]) card.style.removeProperty(property);
  };
}

/** How long a fold takes to settle: the file's code closing, then its unit's
 *  why folding when that was the unit's last file open. */
const SETTLING = 0.8;

/** Keep `element` — the header or button the reader just clicked — where it
 *  is on the window while the page folds around it, until it settles or the
 *  reader scrolls. A file folding under its stuck header takes the window's
 *  place with it otherwise: the page shrinks above it, the scroll stays, and
 *  the reader lands files further down. Put back on every frame the page
 *  changes height in, so it holds through the animation, not after it. */
export function holdInPlace(element: HTMLElement | undefined): Promise<void> {
  if (!element) return Promise.resolve();
  const top = element.getBoundingClientRect().top;
  const putBack = () => {
    const moved = element.getBoundingClientRect().top - top;
    // at once: the page's smooth scrolling is for the reader's jumps, not for holding a place
    if (element.isConnected && Math.abs(moved) > 0.5) window.scrollBy({ top: moved, behavior: "instant" });
  };
  const sizes = new ResizeObserver(putBack);
  sizes.observe(document.body);
  const reader = ["wheel", "touchmove", "keydown"] as const;
  return new Promise((settled) => {
    // the reader moving lets go where they are; settling puts it back once
    // more, for a tab out of sight that drew no frames to hold it on
    const letGo = (reading?: Event) => {
      if (!reading) putBack();
      sizes.disconnect();
      clearTimeout(timer);
      for (const kind of reader) removeEventListener(kind, letGo);
      settled();
    };
    const timer = setTimeout(() => letGo(), SETTLING * 1000);
    for (const kind of reader) addEventListener(kind, letGo, { passive: true });
  });
}

/** Bring a file's header to the window's top as its code folds up into it:
 *  from where it is, over the fold's own time and curve — one motion, so the
 *  reader sees the file close into its header and the next file come up
 *  under it, rather than being taken somewhere — and keep it there while
 *  the page settles (the unit's why folding with it), until the reader scrolls. */
export function glideToTop(section: Element | undefined): Promise<void> {
  if (!section) return Promise.resolve();
  const from = section.getBoundingClientRect().top;
  const curve = cubicBezier(...EASE);
  const start = performance.now();
  const reader = ["wheel", "touchmove", "keydown"] as const;
  return new Promise((settled) => {
    let frame = 0;
    const place = (now: number) => {
      const done = still.matches ? 1 : Math.min(1, (now - start) / (FOLDS * 1000));
      const off = section.getBoundingClientRect().top - (from + (RESTS_AT - from) * curve(done));
      // at once: the page's smooth scrolling is for the reader's jumps, not for this
      if (section.isConnected && Math.abs(off) > 0.5) window.scrollBy({ top: off, behavior: "instant" });
    };
    // put back as the page changes height, before it is painted — the
    // fold takes most of its height in the first frames, and a frame late
    // the header has already slipped out of the window — and on every frame
    // besides, for the glide's own way up
    const sizes = new ResizeObserver(() => place(performance.now()));
    sizes.observe(document.body);
    const letGo = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      sizes.disconnect();
      for (const kind of reader) removeEventListener(kind, letGo);
      settled();
    };
    const step = (now: number) => {
      place(now);
      frame = now - start < SETTLING * 1000 ? requestAnimationFrame(step) : (letGo(), 0);
    };
    // a tab out of sight draws no frames: it lands at the end all the same
    const timer = setTimeout(() => (place(start + SETTLING * 1000), letGo()), SETTLING * 1000 + 100);
    frame = requestAnimationFrame(step);
    for (const kind of reader) addEventListener(kind, letGo, { passive: true });
  });
}

/** An animation's end — or, where no frames come to run it (a tab out of
 *  sight), soon after it should have ended, so nothing is left half open. */
const ended = (run: PromiseLike<unknown>, seconds: number): Promise<unknown> =>
  Promise.race([run, new Promise((done) => setTimeout(done, seconds * 1000 + 100))]);

/** Something opening, as it comes in: from nothing to its own height, fading
 *  in. Call it on the element as it is placed (a ref); it starts closed. */
export function enter(element: HTMLElement): void {
  if (still.matches) return;
  element.style.overflow = "hidden";
  element.style.height = "0px";
  element.style.opacity = "0";
  // placed by the time the code that made it is done; measured then
  queueMicrotask(() => {
    void ended(animate(element, { height: [0, element.scrollHeight], opacity: [0, 1] }, { duration: 0.22, ease: EASE }).finished, 0.22).then(() => {
      for (const property of ["height", "opacity", "overflow"]) element.style.removeProperty(property);
    });
  });
}

/** The gap a row keeps beside an element, and the side it is on: folded
 *  with the element, so nothing snaps when it is placed or taken away. */
const gapBeside = (element: HTMLElement): { readonly side: "marginLeft" | "marginRight"; readonly gap: number } => {
  const row = element.parentElement;
  const gap = row && (element.previousElementSibling || element.nextElementSibling) ? Number.parseFloat(getComputedStyle(row).columnGap) || 0 : 0;
  return { side: element.previousElementSibling ? "marginLeft" : "marginRight", gap };
};

/** Something opening in a row, beside what is there: from nothing to its
 *  own width, fading in — so what stands beside it slides over. */
export function enterSideways(element: HTMLElement): void {
  if (still.matches) return;
  element.style.overflow = "hidden";
  element.style.width = "0px";
  element.style.opacity = "0";
  queueMicrotask(() => {
    // its own width, measured open: squeezed to nothing its contents would read narrower
    element.style.width = "max-content";
    const width = element.offsetWidth;
    element.style.width = "0px";
    const { side, gap } = gapBeside(element);
    void ended(animate(element, { width: [0, width], opacity: [0, 1], [side]: [-gap, 0] }, { duration: 0.22, ease: EASE }).finished, 0.22).then(() => {
      for (const property of ["width", "opacity", "overflow", "margin-left", "margin-right"]) element.style.removeProperty(property);
    });
  });
}

/** Something in a row closing: to no width, fading out — resolves once it is gone. */
export async function leaveSideways(element: HTMLElement | undefined): Promise<void> {
  if (!element || still.matches) return;
  element.style.overflow = "hidden";
  const { side, gap } = gapBeside(element);
  await ended(animate(element, { width: [element.offsetWidth, 0], opacity: [1, 0], [side]: [0, -gap] }, { duration: 0.2, ease: EASE }).finished, 0.2);
}

/** Something closing: to nothing, fading out — resolves once it is gone, for
 *  the caller to take it away then. */
export async function leave(element: HTMLElement | undefined): Promise<void> {
  if (!element || still.matches) return;
  element.style.overflow = "hidden";
  await ended(animate(element, { height: [element.offsetHeight, 0], opacity: [1, 0] }, { duration: 0.2, ease: EASE }).finished, 0.2);
}

/** A `<details>` whose body opens and closes animated: its summary's click
 *  is taken over, the one element after the summary grows in or shrinks
 *  out, and only then does it close. */
export function animateDetails(details: HTMLDetailsElement): void {
  const summary = details.querySelector(":scope > summary");
  summary?.addEventListener("click", (event) => {
    const body = details.querySelector<HTMLElement>(":scope > summary + *");
    if (!body) return;
    event.preventDefault();
    if (!details.open) {
      details.open = true;
      enter(body);
      return;
    }
    void leave(body).then(() => {
      details.open = false;
      for (const property of ["height", "opacity", "overflow"]) body.style.removeProperty(property);
    });
  });
}

/** Where a file's top comes to rest when the page goes to it: under the
 *  window's edge by as much as its header stands off it once stuck (24px in
 *  styles.css), so the header sits where it stays while reading on. */
const RESTS_AT = 24;

/** Take the reader to a section: its top snapped to the top of the window,
 *  not merely brought into view somewhere — the pointer stays on what they
 *  asked for, not on the section above it. */
export function snapToTop(section: Element | null): void {
  if (!section) return;
  const top = section.getBoundingClientRect().top + scrollY - RESTS_AT;
  scrollTo({ top: Math.max(0, top), behavior: still.matches ? "instant" : "smooth" });
}
