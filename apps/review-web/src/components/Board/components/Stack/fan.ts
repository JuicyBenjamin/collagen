import { animate } from "motion";

// A line of work opening, with Motion: from the middle where the stack
// stands, as many cards above as below, the board shaded back behind it.
// Every card alike, evenly apart and tilted back a little; the one in focus
// alone comes flat and a touch larger, on a spring, so moving along
// the line flows from card to card. None at all when the reader asks their
// system for less.

/** How far apart the cards stand when the stack is open, in pixels. */
export const STEP = 46;
const still = matchMedia("(prefers-reduced-motion: reduce)");

/** A stack's parts that move: its front card, the edges of those under it, the fan of every card, and the shade over the board behind. */
export interface Parts {
  readonly face: HTMLElement;
  readonly edges: HTMLElement;
  readonly fan: HTMLElement;
  readonly shade: HTMLElement;
}

/** The pointer over a card, alone or the front of a folded stack: it lifts
 *  a little — a touch larger, and the cards under it, when there are any,
 *  spread a few pixels — so it reads as something to reach for. */
export function lift(face: HTMLElement, edges: HTMLElement | undefined, on: boolean): void {
  const moves = still.matches ? { duration: 0 } : ({ type: "spring", visualDuration: 0.22, bounce: 0.25 } as const);
  animate(face, { scale: on ? 1.015 : 1 }, moves);
  [...(edges?.children ?? [])].forEach((edge, index) => animate(edge, { y: on ? (index + 1) * 2 : 0 }, moves));
}

/** Move a stack to where it is now: open around `focus`, or folded back
 *  into its front card, which gives way to the fan while open. */
export function spread({ face, fan, shade }: Parts, open: boolean, focus: number): void {
  const items = [...fan.querySelectorAll<HTMLElement>(":scope > .board-stack-item")];
  const mid = (items.length - 1) / 2;
  const moves = still.matches ? { duration: 0 } : ({ type: "spring", visualDuration: 0.32, bounce: 0.18 } as const);
  const fades = { duration: still.matches ? 0 : open ? 0.14 : 0.2 };
  animate(fan, { opacity: open ? 1 : 0 }, fades);
  animate(face, { opacity: open ? 0 : 1 }, fades);
  animate(shade, { opacity: open ? 1 : 0 }, { duration: still.matches ? 0 : 0.2 });
  items.forEach((item, index) => {
    const focused = index === focus;
    item.style.zIndex = focused ? "2" : "1";
    animate(
      item,
      open
        ? { y: (index - mid) * STEP, rotateX: focused ? 0 : 6, scale: focused ? 1.02 : 1, filter: `brightness(${focused ? 1 : 0.92})` }
        : { y: 0, rotateX: 0, scale: 1, filter: "brightness(1)" },
      moves,
    );
  });
}
