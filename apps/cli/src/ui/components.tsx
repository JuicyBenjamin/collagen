import { useMemo, useState, type ReactNode } from "react";
import { appendFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme";

interface Entry {
  name: string;
  path: string;
}

function listDirs(dir: string): Entry[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => ({ name: d.name, path: join(dir, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Keep the tail of a path visible (truncate-start). */
function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-(max - 1))}` : s;
}

export function isSpace(key: { name: string; sequence: string }): boolean {
  return key.name === "space" || key.sequence === " ";
}

/** Appends key events to COLLAGEN_LOG's sibling key log when set — so "this
 *  key does nothing" reports come back with data instead of guesses. */
export function keyDebug(where: string, key: { name: string; sequence: string }, extra?: string): void {
  const base = process.env.COLLAGEN_LOG;
  if (!base) return;
  try {
    appendFileSync(
      base + ".keys",
      `${new Date().toISOString()} ${where} name=${JSON.stringify(key.name)} seq=${JSON.stringify(key.sequence)}${extra ? " " + extra : ""}\n`,
    );
  } catch {
    // best-effort
  }
}

/** The kitty keyboard protocol names it "enter", the legacy parser "return". */
export function isEnter(key: { name: string; sequence: string }): boolean {
  return key.name === "return" || key.name === "enter" || key.name === "linefeed" || key.sequence === "\r" || key.sequence === "\n";
}

/** Filesystem folder picker — browse and select a directory (no typing).
 *  Name auto-derives from the folder; path is exact.
 *  Only mounted in pick mode, so its keyboard hook is naturally scoped. */
export function FsPicker({
  start,
  onPick,
  onCancel,
}: {
  start: string;
  onPick: (name: string, path: string) => void;
  onCancel: () => void;
}) {
  const [dir, setDir] = useState(start);
  const [cursor, setCursor] = useState(0);
  const entries = useMemo(() => listDirs(dir), [dir]);
  const { height } = useTerminalDimensions();

  useKeyboard((key) => {
    keyDebug("picker", key);
    if (key.name === "escape") return onCancel();
    if (key.name === "up" || key.name === "k") return setCursor((i) => Math.max(0, i - 1));
    if (key.name === "down" || key.name === "j") return setCursor((i) => Math.min(entries.length - 1, i + 1));
    if (key.name === "left" || key.name === "backspace") {
      setDir((d) => dirname(d));
      setCursor(0);
      return;
    }
    if (key.name === "right") {
      // descend into the highlighted folder
      const e = entries[cursor];
      if (e) {
        setDir(e.path);
        setCursor(0);
      }
      return;
    }
    if (isEnter(key)) {
      // enter picks the highlighted folder; in an empty dir it picks the
      // folder you're standing in
      const e = entries[cursor];
      keyDebug("picker:enter", key, e ? `pick ${e.path}` : `pick-current ${dir}`);
      if (e) return onPick(e.name, e.path);
      return onPick(basename(dir), dir);
    }
    if (isSpace(key)) {
      // select the folder you're currently in
      onPick(basename(dir), dir);
    }
  });

  // window the list so a big folder doesn't overflow the viewport; use as
  // many rows as the terminal allows (header/footer chrome ≈ 12 lines)
  const VIS = Math.max(8, height - 12);
  const top = Math.max(0, Math.min(cursor - Math.floor(VIS / 2), entries.length - VIS));
  const shown = entries.slice(top, top + VIS);

  return (
    <box flexDirection="column">
      <text fg={theme.accent} truncate>{tail(dir, 30)}</text>
      {entries.length === 0 ? (
        <text fg={theme.dim}>(no subfolders)</text>
      ) : (
        shown.map((e) => {
          const i = top + shown.indexOf(e);
          return (
            <text key={e.path} fg={i === cursor ? theme.accent : theme.fg}>
              {i === cursor ? "› " : "  "}
              {e.name}/
            </text>
          );
        })
      )}
      <text fg={theme.dim} truncate>
        ↑↓ · enter pick · → open · ← up · space pick this dir · esc
      </text>
    </box>
  );
}

/** Rounded, titled panel — opentui boxes have native border titles. */
export function Panel({
  title,
  color = theme.accent,
  minWidth,
  grow = false,
  children,
}: {
  title: string;
  color?: string;
  minWidth?: number;
  /** Stretch to absorb the parent's free space (keeps the layout stable). */
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={color}
      title={` ${title} `}
      titleColor={color}
      paddingX={1}
      minWidth={minWidth}
      flexGrow={grow ? 1 : 0}
      flexShrink={grow ? 1 : 0}
    >
      {children}
    </box>
  );
}
