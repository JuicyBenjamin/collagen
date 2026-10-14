/** The opening: what the logo looks like `t` ms after the app started. Pure,
 *  so it can be tested frame by frame. The letters come in one by one with a
 *  flash, a sheen sweeps across them while the runtime is still coming up,
 *  the tagline types itself, and when `readyAt` is set the whole thing flashes
 *  once and settles into the brand colour. Nothing here knows about React or
 *  the terminal — it maps time to colours. */

export interface LogoPalette {
  readonly accent: string;
  readonly foreground: string;
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

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeOut = (progress: number) => 1 - (1 - progress) * (1 - progress) * (1 - progress);

/** Linear blend of two `#rrggbb` colours. */
export const mix = (from: string, to: string, amount: number): string => {
  const weight = clamp01(amount);
  const channel = (offset: number) => {
    const fromValue = parseInt(from.slice(offset, offset + 2), 16);
    const toValue = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(fromValue + (toValue - fromValue) * weight)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
};

/**
 * @param elapsed    ms since the logo appeared
 * @param readyAt    ms (same clock) when the app came up, or null while booting
 * @param letters    column count of each letter, in order (letterspace excluded)
 * @param tagline    the full tagline
 */
export const logoFrame = (
  elapsed: number,
  readyAt: number | null,
  letters: ReadonlyArray<number>,
  tagline: string,
  palette: LogoPalette,
): LogoFrame => {
  const base = mix(palette.dim, palette.accent, 0.6);
  const total = letters.reduce((sum, width) => sum + width, 0) + Math.max(0, letters.length - 1);
  const revealDone = LOGO.letterEvery * (letters.length - 1) + LOGO.letterFlash;
  const settleT = readyAt === null ? 0 : clamp01((elapsed - readyAt) / LOGO.settle);
  const settled = readyAt !== null && settleT >= 1;

  // the sheen: a soft band sweeping left to right, over and over, until ready
  const phase = ((elapsed - revealDone) % LOGO.sheenPeriod) / LOGO.sheenPeriod;
  const center = -LOGO.sheenWidth * 2 + (total + LOGO.sheenWidth * 4) * phase;
  const sheenOn = readyAt === null && elapsed >= revealDone;

  const columns: Array<string | null> = [];
  letters.forEach((width, index) => {
    const shownAt = LOGO.letterEvery * index;
    const hidden = elapsed < shownAt && readyAt === null;
    if (index > 0) columns.push(hidden ? null : base); // the letterspace arrives with its letter
    for (let cell = 0; cell < width; cell++) {
      if (hidden) {
        columns.push(null);
        continue;
      }
      // a letter arrives white-hot and cools to the base
      const flash = clamp01(1 - (elapsed - shownAt) / LOGO.letterFlash);
      let color = mix(base, palette.foreground, easeOut(flash));
      if (sheenOn) {
        const col = columns.length;
        const distance = (col - center) / LOGO.sheenWidth;
        const glow = Math.exp(-distance * distance);
        color = mix(color, "#ffffff", 0.65 * glow);
      }
      if (readyAt !== null) {
        // ready: one flash, then ease into the brand colour and stay there
        const flashIn = clamp01((elapsed - readyAt) / 90);
        color = settleT < 0.16 ? mix(color, palette.foreground, flashIn) : mix(palette.foreground, palette.accent, easeOut((settleT - 0.16) / 0.84));
      }
      columns.push(color);
    }
  });

  const typed = readyAt !== null ? tagline.length : Math.max(0, Math.min(tagline.length, Math.floor((elapsed - LOGO.taglineFrom) / LOGO.taglineEvery)));
  const cursor = settled || readyAt !== null ? "" : Math.floor(elapsed / LOGO.cursorBlink) % 2 === 0 ? "▌" : " ";
  const taglineColor = readyAt === null ? mix(palette.dim, palette.foreground, 0.35) : mix(mix(palette.dim, palette.foreground, 0.35), palette.dim, settleT);

  return { columns, tagline: tagline.slice(0, typed), taglineColor, cursor, done: settled };
};
