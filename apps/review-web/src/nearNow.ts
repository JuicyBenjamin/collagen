import { createSignal } from "solid-js";
import { hostNow } from "./hostNow";

// Which files' code is drawn: a review of hundreds of files drawn whole is a
// page of hundreds of thousands of elements, where every change to the
// layout costs a long pause. So a file's card holds its code only while it is
// near the window — a couple of screens either way — and stands as a block
// of its height the rest of the time. Some must be drawn wherever they are:
// one the reader is being taken to, and one with lines picked in it.

/** How far from the window a file's code is drawn: two screens above and below. */
const NEAR = "200% 0px";

const [taken, setTaken] = createSignal<ReadonlySet<string>>(new Set());

/** One watcher for every card; each card's own answer to it. */
const answers = new WeakMap<Element, (entry: IntersectionObserverEntry) => void>();
let watcher: IntersectionObserver | null = null;
const watching = (): IntersectionObserver =>
  (watcher ??= new IntersectionObserver((entries) => entries.forEach((entry) => answers.get(entry.target)?.(entry)), { rootMargin: NEAR }));

/** A hunk id's file: `<file>#<n>`. */
const fileOf = (hunkId: string): string => hunkId.slice(0, hunkId.lastIndexOf("#"));

export const nearNow = {
  /** Follow a card: told whether it is near the window, with its height as
   *  it stood (read from the watcher, never by measuring the page). */
  watch(card: Element, near: (isNear: boolean, height: number) => void): () => void {
    answers.set(card, (entry) => near(entry.isIntersecting, entry.boundingClientRect.height));
    watching().observe(card);
    return () => {
      answers.delete(card);
      watching().unobserve(card);
    };
  },
  /** Is a file's code to be drawn wherever it is? */
  kept(file: string): boolean {
    const picked = hostNow.pick();
    return taken().has(file) || (picked !== null && fileOf(picked.hunk) === file);
  },
  /** Draw a file's code before the reader is taken to something in it:
   *  resolves once it is on the page. */
  reveal(file: string): Promise<void> {
    if (!taken().has(file)) setTaken(new Set([...taken(), file]));
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  },
  /** The reader has been taken there: it may go when far again. */
  release(file: string): void {
    if (!taken().has(file)) return;
    const left = new Set(taken());
    left.delete(file);
    setTaken(left);
  },
};
