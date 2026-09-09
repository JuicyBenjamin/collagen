/** The opening: what the logo looks like `t` ms after the app started. Pure,
 *  so it can be tested frame by frame. The letters come in one by one with a
 *  flash, a sheen sweeps across them while the runtime is still coming up,
 *  the tagline types itself, and when `readyAt` is set the whole thing flashes
 *  once and settles into the brand colour. Nothing here knows about React or
 *  the terminal — it maps time to colours. */

export interface LogoPalette {
  readonly accent: string;
  readonly fg: string;
  readonly dim: string;
}

export interface LogoFrame {
  /** one colour per column of the logo (a hex string); null = not drawn yet */
  readonly columns: ReadonlyArray<string | null>;
  /** how much of the tagline is typed */
  readonly tagline: string;
  readonly taglineColor: string;
  /** the blinking cursor after the tagline, "" once settled */
  readonly cursor: string;
  /** true once the last settle frame is drawn — the timer can stop */
  readonly done: boolean;
}

/** timings, ms */
export const LOGO = {
  letterEvery: 90,
  letterFlash: 320,
  sheenPeriod: 1600,
  sheenWidth: 3,
  taglineFrom: 700,
  taglineEvery: 45,
  cursorBlink: 480,
  settle: 550,
} as const;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);

/** Linear blend of two `#rrggbb` colours. */
export const mix = (a: string, b: string, t: number): string => {
  const k = clamp01(t);
  const ch = (i: number) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${ch(1)}${ch(3)}${ch(5)}`;
};

/**
 * @param t          ms since the logo appeared
 * @param readyAt    ms (same clock) when the app came up, or null while booting
 * @param letters    column count of each letter, in order (letterspace excluded)
 * @param tagline    the full tagline
 */
export const logoFrame = (
  t: number,
  readyAt: number | null,
  letters: ReadonlyArray<number>,
  tagline: string,
  p: LogoPalette,
): LogoFrame => {
  const base = mix(p.dim, p.accent, 0.6);
  const total = letters.reduce((n, w) => n + w, 0) + Math.max(0, letters.length - 1);
  const revealDone = LOGO.letterEvery * (letters.length - 1) + LOGO.letterFlash;
  const settleT = readyAt === null ? 0 : clamp01((t - readyAt) / LOGO.settle);
  const settled = readyAt !== null && settleT >= 1;

  // the sheen: a soft band sweeping left to right, over and over, until ready
  const phase = ((t - revealDone) % LOGO.sheenPeriod) / LOGO.sheenPeriod;
  const center = -LOGO.sheenWidth * 2 + (total + LOGO.sheenWidth * 4) * phase;
  const sheenOn = readyAt === null && t >= revealDone;

  const columns: Array<string | null> = [];
  letters.forEach((width, i) => {
    const shownAt = LOGO.letterEvery * i;
    const hidden = t < shownAt && readyAt === null;
    if (i > 0) columns.push(hidden ? null : base); // the letterspace arrives with its letter
    for (let c = 0; c < width; c++) {
      if (hidden) {
        columns.push(null);
        continue;
      }
      // a letter arrives white-hot and cools to the base
      const flash = clamp01(1 - (t - shownAt) / LOGO.letterFlash);
      let color = mix(base, p.fg, easeOut(flash));
      if (sheenOn) {
        const col = columns.length;
        const d = (col - center) / LOGO.sheenWidth;
        const glow = Math.exp(-d * d);
        color = mix(color, "#ffffff", 0.65 * glow);
      }
      if (readyAt !== null) {
        // ready: one flash, then ease into the brand colour and stay there
        const flashIn = clamp01((t - readyAt) / 90);
        color = settleT < 0.16 ? mix(color, p.fg, flashIn) : mix(p.fg, p.accent, easeOut((settleT - 0.16) / 0.84));
      }
      columns.push(color);
    }
  });

  const typed = readyAt !== null ? tagline.length : Math.max(0, Math.min(tagline.length, Math.floor((t - LOGO.taglineFrom) / LOGO.taglineEvery)));
  const cursor = settled || readyAt !== null ? "" : Math.floor(t / LOGO.cursorBlink) % 2 === 0 ? "▌" : " ";
  const taglineColor = readyAt === null ? mix(p.dim, p.fg, 0.35) : mix(mix(p.dim, p.fg, 0.35), p.dim, settleT);

  return { columns, tagline: tagline.slice(0, typed), taglineColor, cursor, done: settled };
};
