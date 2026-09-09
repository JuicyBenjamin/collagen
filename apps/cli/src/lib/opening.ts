import { LOGO } from "./logoFrame";

/** The opening's timeline and where the logo sits in it. Pure. Times in ms
 *  since the logo first painted.
 *
 *    boot     — centred on the screen, letters revealing, sheen sweeping
 *    settle   — the app is up: flash, ease into the brand colour (still centred)
 *    move     — glide to the header position
 *    done     — the still logo in the header, the app beneath it
 *
 *  `upAt` is when the runtime came up; the settle never starts before
 *  `HOLD` so the reveal and one sweep are always seen — a boot that is fast
 *  is still an opening, not a flicker. */
export const OPENING = {
  hold: 2200,
  move: 650,
} as const;

export interface OpeningFrame {
  readonly phase: "boot" | "settle" | "move" | "done";
  /** what `logoFrame` should treat as ready-time (null while booting) */
  readonly readyAt: number | null;
  /** offset from the header position, in cells */
  readonly x: number;
  readonly y: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * @param t       ms since the logo painted
 * @param upAt    ms when the app came up, or null
 * @param cols    terminal columns, rows; logo width/height in cells (tagline included)
 */
export const opening = (
  t: number,
  upAt: number | null,
  dims: { cols: number; rows: number; w: number; h: number },
): OpeningFrame => {
  const cx = Math.max(0, Math.floor((dims.cols - dims.w) / 2) - 1); // -1: the layout's own padding
  const cy = Math.max(0, Math.floor((dims.rows - dims.h) / 2) - 1);
  const readyAt = upAt === null ? null : Math.max(upAt, OPENING.hold);
  if (readyAt === null || t < readyAt) return { phase: "boot", readyAt: null, x: cx, y: cy };
  const moveStart = readyAt + LOGO.settle;
  if (t < moveStart) return { phase: "settle", readyAt, x: cx, y: cy };
  const m = clamp01((t - moveStart) / OPENING.move);
  if (m >= 1) return { phase: "done", readyAt, x: 0, y: 0 };
  const e = 1 - easeInOut(m);
  return { phase: "move", readyAt, x: Math.round(cx * e), y: Math.round(cy * e) };
};
