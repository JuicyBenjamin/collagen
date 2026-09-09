import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fonts } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { theme } from "../../app/theme";
import { logoFrame } from "../../lib/logoFrame";
import { opening } from "../../lib/opening";
import { roomAtom } from "../../routes/atoms";

const WORD = "collagen";
const TAGLINE = "peer-to-peer";
const FPS = 30;

/** The word in the tiny font, one string per row, plus each letter's width —
 *  the same glyphs `<ascii-font>` draws, laid out by hand so every column can
 *  take its own colour. */
const glyphs = (() => {
  const font = fonts.tiny;
  const rows: string[] = Array.from({ length: font.lines }, () => "");
  const widths: number[] = [];
  [...WORD.toUpperCase()].forEach((ch, i) => {
    const g = (font.chars as Record<string, string[]>)[ch] ?? font.chars["?"];
    if (i > 0) rows.forEach((_, r) => (rows[r] += font.letterspace[r] ?? " "));
    rows.forEach((_, r) => (rows[r] += g[r] ?? ""));
    widths.push(Math.max(...g.map((l) => [...l].length)));
  });
  const cells = rows.map((r) => [...r]);
  return { rows: cells, widths, w: Math.max(...cells.map((c) => c.length)), h: cells.length + 1 };
})();

/** One row of the logo, coloured per column, adjacent equal colours merged. */
function Row({ cells, colors }: { cells: ReadonlyArray<string>; colors: ReadonlyArray<string | null> }) {
  const runs: Array<{ text: string; color: string | null }> = [];
  cells.forEach((ch, i) => {
    const color = colors[i] ?? null;
    const shown = color === null ? " " : ch;
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.text += shown;
    else runs.push({ text: shown, color });
  });
  return (
    <text>
      {runs.map((r, i) => (
        <span key={i} fg={r.color ?? theme.dim}>
          {r.text}
        </span>
      ))}
    </text>
  );
}

/** The brand, still — for screens that have no runtime to wait for. */
export function Logo() {
  return (
    <>
      <ascii-font text={WORD} font="tiny" color={theme.accent} />
      <text fg={theme.dim}>{TAGLINE}</text>
    </>
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
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  const [upAt, setUpAt] = useState<number | null>(null);
  useEffect(() => {
    if (up && upAt === null) setUpAt(Date.now() - t0);
  }, [up, upAt, t0]);

  const t = now - t0;
  const where = useMemo(() => opening(t, upAt, { cols: width, rows: height, w: glyphs.w, h: glyphs.h }), [t, upAt, width, height]);
  const frame = useMemo(() => logoFrame(t, where.readyAt, glyphs.widths, TAGLINE, theme), [t, where.readyAt]);
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
    <box flexDirection="column" marginLeft={where.x} marginTop={where.y}>
      {glyphs.rows.map((cells, r) => (
        <Row key={r} cells={cells} colors={frame.columns} />
      ))}
      <text>
        <span fg={frame.taglineColor}>{frame.tagline}</span>
        <span fg={theme.accent}>{frame.cursor}</span>
      </text>
    </box>
  );
}
