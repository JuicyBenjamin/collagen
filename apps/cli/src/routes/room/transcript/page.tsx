import { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { wrap } from "../../../lib/wrap";
import { transcriptLinesAtom } from "../transcripts/atoms";

const hhmmss = (ts: string | null) => (ts ? ts.slice(11, 19) : "  ·  ·  ");

const whoColor = (who: string) =>
  who === "user" ? theme.accent : who === "assistant" ? theme.warn : who.startsWith("collagen") ? theme.ok : theme.dim;

/** One collected transcript, readable: the turns, one line each —
 *  `HH:MM:SS  who  first line` — in a viewport that takes the space the layout
 *  leaves (measured after layout, never estimated). ↑↓ by turn, PageUp/PageDown
 *  by screen, Home/End; follows the newest until you scroll up. enter unfolds
 *  a turn's text in full under its row, enter again folds it. ← / esc go back
 *  to the list. */
export function TranscriptPage({ path, file }: { path: string; file: string }) {
  const { width } = useTerminalDimensions();
  const setFocus = useAtomSet(focusAtom);
  const loadLines = useAtomSet(transcriptLinesAtom);
  const linesResult = useAtomValue(transcriptLinesAtom);
  const [turnSel, setTurnSel] = useState<number | null>(null);
  const [unfolded, setUnfolded] = useState<number | null>(null);
  // the rows box takes what the layout leaves; we read how many rows that is
  const listRef = useRef<BoxRenderable>(null);
  const [viewport, setViewport] = useState(8);
  useEffect(() => {
    const h = listRef.current?.height;
    if (h && h > 0 && h !== viewport) setViewport(h);
  });

  useEffect(() => {
    setFocus("transcript-lines");
    loadLines({ path });
    setTurnSel(null);
    setUnfolded(null);
  }, [setFocus, loadLines, path]);

  const turns = AsyncResult.getOrElse(linesResult, () => [] as const);
  const lastTurn = Math.max(0, turns.length - 1);
  const tSel = turnSel === null ? lastTurn : clamp(turnSel, 0, lastTurn);
  const textWidth = Math.max(30, width - 30);
  const firstLine = (text: string) => {
    const line = text.split("\n")[0] ?? "";
    const room = Math.max(10, textWidth - 26);
    return line.length > room ? `${line.slice(0, room - 1)}…` : line;
  };
  // rows: one per turn, plus the unfolded turn's text wrapped under its row
  const rows = turns.flatMap((t, turn) => {
    const head = { kind: "head" as const, turn, text: "" };
    if (turn !== unfolded) return [head];
    const body = wrap(t.text.length > 0 ? t.text : "(nothing said in this turn)", textWidth);
    return [head, ...body.map((text) => ({ kind: "body" as const, turn, text }))];
  });
  const maxStart = Math.max(0, rows.length - viewport);
  const headRow = Math.max(0, rows.findIndex((r) => r.turn === tSel));
  const start = turnSel === null ? maxStart : clamp(Math.min(headRow, maxStart), 0, maxStart);
  const jump = (toTurn: number) => setTurnSel(toTurn >= lastTurn ? null : Math.max(0, toTurn));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="transcript-lines"
        hint="↑↓ turn · pgup/pgdn screen · home/end · enter unfold / fold · ← / esc back to the list"
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (key.name === "up" && tSel > 0) return jump(tSel - 1), true;
          if (key.name === "down" && tSel < lastTurn) return jump(tSel + 1), true;
          if (key.name === "pageup") return jump(tSel - viewport), true;
          if (key.name === "pagedown") return jump(tSel + viewport), true;
          if (key.name === "home") return jump(0), true;
          if (key.name === "end") return jump(lastTurn), true;
          if (isEnter(key) && turns.length > 0) return setUnfolded((u) => (u === tSel ? null : tSel)), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>{file}</span>
              <span fg={theme.dim}> · {turns.length} turn(s)</span>
            </text>
            <box ref={listRef} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
              {AsyncResult.isWaiting(linesResult) ? (
                <text fg={theme.dim} flexShrink={0}>
                  {"  "}reading…
                </text>
              ) : turns.length === 0 ? (
                <text fg={theme.dim} flexShrink={0}>
                  {"  "}nothing readable in this file
                </text>
              ) : (
                rows.slice(start, start + viewport).map((r, i) => {
                  const t = turns[r.turn]!;
                  const selected = focused && r.turn === tSel;
                  return r.kind === "head" ? (
                    <text key={`${path}:${start + i}`} truncate wrapMode="none" flexShrink={0}>
                      <span fg={selected ? theme.accent : theme.dim}>{selected ? (unfolded === r.turn ? "▾ " : "› ") : "  "}</span>
                      <span fg={theme.dim}>{hhmmss(t.ts)}  </span>
                      <span fg={whoColor(t.who)}>{t.who.padEnd(11)}</span>
                      <span fg={selected ? theme.accent : t.who === "user" || t.who === "assistant" ? theme.fg : theme.dim}>
                        {unfolded === r.turn ? "" : firstLine(t.text)}
                      </span>
                    </text>
                  ) : (
                    <text key={`${path}:${start + i}`} fg={theme.fg} truncate wrapMode="none" flexShrink={0}>
                      {"            "}
                      {r.text}
                    </text>
                  );
                })
              )}
            </box>
          </>
        )}
      </Focusable>
    </box>
  );
}
