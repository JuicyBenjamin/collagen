import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { KIND_ORDER, KINDS } from "@collagen/p2p";
import { theme } from "../../../../../app/theme";
import { EPIC_HELP, EPIC_MARK, GLYPH, KIND_GLYPH, MARK_HELP, MARK_ORDER, STACK, STACK_HELP } from "../../../../../lib/glyphs";
import { clamp } from "../../../../../lib/math";
import { STATE_LABEL, STATE_ORDER, STATE_WORDS } from "../../../../../lib/ticketSummary";

export const HELP_HINT = "↑↓ scroll · ? close · esc close";

const COL = 10;

/** Every line of the panel, in reading order — each one a row on screen. */
function helpLines(): ReadonlyArray<{ readonly key: string; readonly node: ReactNode }> {
  const pad = " ".repeat(COL);
  const out: Array<{ key: string; node: ReactNode }> = [];
  const head = (key: string, title: string) => out.push({ key, node: <span fg={theme.accent}>{title}</span> });
  const gap = (key: string) => out.push({ key, node: " " });
  head("h-kinds", "ticket kinds");
  for (const kind of KIND_ORDER) {
    const k = KINDS[kind];
    out.push({
      key: `${kind}-what`,
      node: (
        <>
          {"  "}
          {/* the glyph an epic's tickets carry for their kind; the epic's is its crown */}
          <span fg={kind === "epic" ? theme.epic : theme.dim}>{kind === "epic" ? EPIC_MARK : KIND_GLYPH[kind]} </span>
          <span fg={theme.fg}>{kind.padEnd(COL)}</span>
          <span fg={theme.fg}>{k.what}</span>
        </>
      ),
    });
    out.push({ key: `${kind}-asks`, node: <span fg={theme.dim}>{`    ${pad}asks: ${k.asks}`}</span> });
    out.push({ key: `${kind}-closes`, node: <span fg={theme.dim}>{`    ${pad}closed by ${k.closes}`}</span> });
  }
  gap("g-marks");
  head("h-marks", "marks");
  for (const m of MARK_ORDER) {
    out.push({
      key: `mark-${m}`,
      node: (
        <>
          {"  "}
          <span fg={m === "yours" ? theme.warn : theme.fg}>{GLYPH[m].padEnd(COL)}</span>
          <span fg={theme.dim}>{MARK_HELP[m]}</span>
        </>
      ),
    });
  }
  out.push({
    key: "mark-self",
    node: (
      <>
        {"  "}
        <span fg={theme.fg}>{`self ${GLYPH.approved}`.padEnd(COL)}</span>
        <span fg={theme.dim}>the author's own take on their own ticket</span>
      </>
    ),
  });
  out.push({ key: "mark-none", node: <span fg={theme.dim}>{`  ${pad}a name with no mark has said nothing yet`}</span> });
  for (const k of ["follows", "waits"] as const) {
    out.push({
      key: `stack-${k}`,
      node: (
        <>
          {"  "}
          <span fg={theme.fg}>{STACK[k].padEnd(COL)}</span>
          <span fg={theme.dim}>{STACK_HELP[k]}</span>
        </>
      ),
    });
  }
  out.push({
    key: "epic",
    node: (
      <>
        {"  "}
        <span fg={theme.epic}>{EPIC_MARK.padEnd(COL)}</span>
        <span fg={theme.dim}>{EPIC_HELP}</span>
      </>
    ),
  });

  gap("g-states");
  head("h-states", "states");
  for (const s of STATE_ORDER) {
    out.push({
      key: `state-${s}`,
      node: (
        <>
          {"  "}
          <span fg={s === "needs-you" ? theme.warn : theme.fg}>{STATE_LABEL[s].padEnd(COL)}</span>
          <span fg={theme.dim}>{STATE_WORDS[s]}</span>
        </>
      ),
    });
  }
  gap("g-list");
  head("h-list", "the list");
  for (const [key, what] of LIST_KEYS)
    out.push({
      key: `list-${key}`,
      node: (
        <>
          {"  "}
          <span fg={theme.fg}>{key.padEnd(COL)}</span>
          <span fg={theme.dim}>{what}</span>
        </>
      ),
    });
  return out;
}

/** The list's own keys, beyond moving and opening. */
const LIST_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["tab", "the next tab: every ticket, then one kind at a time, by project (shift-tab, [ and ] too)"],
  ["h", "the closed tickets too, below the open ones, each saying how it ended"],
  ["e", "open the epic the ticket is in"],
  ["p", "open the ticket it grew out of"],
];

/** What the overview's words and glyphs mean, on demand (`?`): the kinds of
 *  ticket — what each is, what it asks of a reader, who closes it — then the
 *  marks, then the states. The agents learn all of this from the tool text;
 *  the person had it nowhere but the docs site. Every line is read from the
 *  same tables the rest of the app uses (p2p KINDS, lib/glyphs, the summary's
 *  states), so this panel cannot drift from what the screen shows.
 *
 *  It scrolls (↑↓) when the terminal is shorter than the panel; the rows it
 *  has are read from the layout after each frame, never estimated. The
 *  overview owns open and close, and holds the keyboard while it is open. */
export function Help() {
  const lines = helpLines();
  const ref = useRef<BoxRenderable>(null);
  // start small: a box filled to the brim measures its content, not the room
  // it has — the first frame shows a few rows, the layout says how many fit
  const [height, setHeight] = useState(8);
  const [top, setTop] = useState(0);
  // measured after the layout has run (a tick after the render that drew
  // it), and again whenever the terminal is resized
  const { height: terminalRows } = useTerminalDimensions();
  useEffect(() => {
    const timer = setTimeout(() => {
      const h = ref.current?.height;
      if (h && h > 0 && h !== height) setHeight(h);
    }, 16);
    return () => clearTimeout(timer);
  });
  void terminalRows;
  const more = lines.length > height;
  // one row for the "more" line when it does not all fit
  const rows = more ? Math.max(1, height - 1) : height;
  const maxTop = Math.max(0, lines.length - rows);
  const start = clamp(top, 0, maxTop);

  useKeyboard((key) => {
    if (key.name === "up") setTop(Math.max(0, start - 1));
    if (key.name === "down") setTop(Math.min(maxTop, start + 1));
    if (key.name === "pageup") setTop(Math.max(0, start - rows));
    if (key.name === "pagedown") setTop(Math.min(maxTop, start + rows));
  });

  return (
    <box ref={ref} flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      {lines.slice(start, start + rows).map((l) => (
        <text key={l.key} truncate wrapMode="none" flexShrink={0}>
          {l.node}
        </text>
      ))}
      {more ? (
        <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
          {start < maxTop ? `  ↓ ${lines.length - start - rows} more` : "  ↑ that is all"}
        </text>
      ) : null}
    </box>
  );
}
