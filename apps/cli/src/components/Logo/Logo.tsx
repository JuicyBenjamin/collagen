import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fonts } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { theme } from "../../app/theme";
import { VERSION } from "../../app/version";
import { logoFrame } from "../../lib/logoFrame";
import { opening } from "../../lib/opening";
import { versionLabel } from "../../lib/versionLabel";
import { roomAtom } from "../../routes/atoms";

const WORD = "collagen";
/** What the brand says under itself: what this is, and which build you have.
 *  The stage belongs here rather than only in the footer — an alpha should
 *  introduce itself as one. */
const TAGLINE = `peer-to-peer · ${versionLabel(VERSION)}`;
const FPS = 30;

/** The word in the tiny font, one string per row, plus each letter's width —
 *  the same glyphs `<ascii-font>` draws, laid out by hand so every column can
 *  take its own colour. */
const glyphs = (() => {
  const font = fonts.tiny;
  const rows: string[] = Array.from({ length: font.lines }, () => "");
  const widths: number[] = [];
  [...WORD.toUpperCase()].forEach((letter, index) => {
    const glyph = (font.chars as Record<string, string[]>)[letter] ?? font.chars["?"];
    if (index > 0) rows.forEach((_, rowIndex) => (rows[rowIndex] += font.letterspace[rowIndex] ?? " "));
    rows.forEach((_, rowIndex) => (rows[rowIndex] += glyph[rowIndex] ?? ""));
    widths.push(Math.max(...glyph.map((line) => [...line].length)));
  });
  const cells = rows.map((row) => [...row]);
  // +2: the row of air under the word, then the tagline
  return { rows: cells, widths, w: Math.max(...cells.map((row) => row.length)), h: cells.length + 2 };
})();

/** One row of the logo, coloured per column, adjacent equal colours merged. */
function Row({ cells, colors }: { cells: ReadonlyArray<string>; colors: ReadonlyArray<string | null> }) {
  const runs: Array<{ text: string; color: string | null }> = [];
  cells.forEach((cell, index) => {
    const color = colors[index] ?? null;
    const shown = color === null ? " " : cell;
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.text += shown;
    else runs.push({ text: shown, color });
  });
  return (
    <text>
      {runs.map((run, index) => (
        <span key={index} fg={run.color ?? theme.dim}>
          {run.text}
        </span>
      ))}
    </text>
  );
}

/** The brand, still — for screens that have no runtime to wait for. */
export function Logo() {
  return (
    // flexShrink 0: the header is not the thing that gives way when the page
    // below it grows — squeezing it out is layout shift, and it looked like
    // the tagline jumping into the wordmark
    <box flexDirection="column" flexShrink={0}>
      <ascii-font text={WORD} font="tiny" color={theme.accent} />
      {/* one row of air, the same as the room's header gets below: the glyphs
          fill their cells, so text on the next row touches them */}
      <text fg={theme.dim} marginTop={1} flexShrink={0}>
        {TAGLINE}
      </text>
    </box>
  );
}

/** The opening. The logo starts in the middle of the screen and animates
 *  from the first frame until the app is up — letters revealing, a sheen
 *  sweeping — then flashes, settles into the brand colour, glides up into
 *  the header, and the app appears beneath it. It never guesses how long the
 *  boot takes; a fast one is held just long enough to be seen. `children` is
 *  the app, mounted once the logo has arrived. */
export function Opening({ children }: { children: ReactNode }) {
  const room = useAtomValue(roomAtom);
  const up = AsyncResult.isSuccess(room) || AsyncResult.isFailure(room);
  const { width, height } = useTerminalDimensions();
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const [upAt, setUpAt] = useState<number | null>(null);
  useEffect(() => {
    if (up && upAt === null) setUpAt(Date.now() - startedAt);
  }, [up, upAt, startedAt]);

  const elapsed = now - startedAt;
  const where = useMemo(() => opening(elapsed, upAt, { cols: width, rows: height, width: glyphs.w, height: glyphs.h }), [elapsed, upAt, width, height]);
  const frame = useMemo(() => logoFrame(elapsed, where.readyAt, glyphs.widths, TAGLINE, { accent: theme.accent, foreground: theme.fg, dim: theme.dim }), [elapsed, where.readyAt]);
  const done = where.phase === "done";

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setNow(Date.now()), 1000 / FPS);
    return () => clearInterval(id);
  }, [done]);

  if (done) {
    return (
      <>
        <Logo />
        {children}
      </>
    );
  }
  return (
    <box flexDirection="column" marginLeft={where.x} marginTop={where.y} flexShrink={0}>
      {glyphs.rows.map((cells, index) => (
        <Row key={index} cells={cells} colors={frame.columns} />
      ))}
      <text marginTop={1}>
        <span fg={frame.taglineColor}>{frame.tagline}</span>
        <span fg={theme.accent}>{frame.cursor}</span>
      </text>
    </box>
  );
}
