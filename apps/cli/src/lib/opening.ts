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

const easeInOut = (progress: number) => (progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2);
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * @param elapsed ms since the logo painted
 * @param upAt    ms when the app came up, or null
 * @param cols    terminal columns, rows; logo width/height in cells (tagline included)
 */
export const opening = (
  elapsed: number,
  upAt: number | null,
  dims: { cols: number; rows: number; width: number; height: number },
): OpeningFrame => {
  const centerX = Math.max(0, Math.floor((dims.cols - dims.width) / 2) - 1); // -1: the layout's own padding
  const centerY = Math.max(0, Math.floor((dims.rows - dims.height) / 2) - 1);
  const readyAt = upAt === null ? null : Math.max(upAt, OPENING.hold);
  if (readyAt === null || elapsed < readyAt) return { phase: "boot", readyAt: null, x: centerX, y: centerY };
  const moveStart = readyAt + LOGO.settle;
  if (elapsed < moveStart) return { phase: "settle", readyAt, x: centerX, y: centerY };
  const progress = clamp01((elapsed - moveStart) / OPENING.move);
  if (progress >= 1) return { phase: "done", readyAt, x: 0, y: 0 };
  const eased = 1 - easeInOut(progress);
  return { phase: "move", readyAt, x: Math.round(centerX * eased), y: Math.round(centerY * eased) };
};
