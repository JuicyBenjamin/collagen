import { useMemo, useState, type ReactNode } from "react";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { useKeyboard } from "@opentui/react";
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

  useKeyboard((key) => {
    if (key.name === "escape") return onCancel();
    if (key.name === "up" || key.name === "k") return setCursor((i) => Math.max(0, i - 1));
    if (key.name === "down" || key.name === "j") return setCursor((i) => Math.min(entries.length - 1, i + 1));
    if (key.name === "left" || key.name === "backspace") {
      setDir((d) => dirname(d));
      setCursor(0);
      return;
    }
    if (key.name === "right" || key.name === "return") {
      const e = entries[cursor];
      if (e) {
        setDir(e.path);
        setCursor(0);
      }
      return;
    }
    if (isSpace(key)) {
      // select the folder you're currently in
      onPick(basename(dir), dir);
    }
  });

  // window the list so a big folder doesn't overflow the viewport
  const VIS = 8;
  const top = Math.max(0, Math.min(cursor - 3, entries.length - VIS));
  const shown = entries.slice(top, top + VIS);

  return (
    <box flexDirection="column">
      <text fg={theme.accent}>{tail(dir, 60)}</text>
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
        ↑↓ move · → enter · ← up · space select this folder · esc cancel
      </text>
    </box>
  );
}

/** Rounded, titled panel — opentui boxes have native border titles. */
export function Panel({
  title,
  color = theme.accent,
  minWidth,
  children,
}: {
  title: string;
  color?: string;
  minWidth?: number;
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
    >
      {children}
    </box>
  );
}
