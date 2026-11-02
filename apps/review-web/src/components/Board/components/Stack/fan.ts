import { animate } from "motion";

// A line of work opening, with Motion: from the middle where the stack
// stands, as many cards above as below, read like a game menu — the board
// shaded back behind it, the card in focus flat, forward and largest, the
// rest curving away from it, smaller, tilted and darker the further off,
// each still solid. A spring, so focus moving along the line rolls rather
// than slides; none at all when the reader asks their system for less.

/** How far apart the cards stand when the stack is open, in pixels. */
export const STEP = 46;
const still = matchMedia("(prefers-reduced-motion: reduce)");

/** A stack's parts that move: its front card, the fan of every card, and the shade over the board behind. */
export interface Parts {
  readonly face: HTMLElement;
  readonly fan: HTMLElement;
  readonly shade: HTMLElement;
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
    const off = index - focus;
    const far = Math.abs(off);
    // the wheel curves no further than three cards off: a long line's far ends stay readable
    const bend = Math.sign(off) * Math.min(far, 3);
    item.style.zIndex = String(50 - far);
    animate(
      item,
      open
        ? { y: (index - mid) * STEP, z: far === 0 ? 40 : -Math.abs(bend) * 34, rotateX: -bend * 12, scale: far === 0 ? 1.06 : 1 - Math.abs(bend) * 0.05, filter: `brightness(${Math.max(0.45, 1 - far * 0.16)})` }
        : { y: 0, z: 0, rotateX: 0, scale: 1, filter: "brightness(1)" },
      moves,
    );
  });
}
