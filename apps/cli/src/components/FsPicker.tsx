import { useMemo, useState } from "react";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../app/theme";
import { isEnter, isSpace, keyDebug } from "./keys";

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

export const FS_PICKER_HINT = "↑↓ move · → open · ← up · enter pick · space pick this dir · esc cancel";

/** Filesystem folder picker — browse and select a directory (no typing).
 *  Name auto-derives from the folder; path is exact.
 *  Only mounted while picking, so its keyboard hook is naturally scoped. */
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
      if (e) return onPick(e.name, e.path);
      return onPick(basename(dir), dir);
    }
    if (isSpace(key)) onPick(basename(dir), dir);
  });

  // window the list so a big folder doesn't overflow the viewport; use as
  // many rows as the terminal allows (header/footer chrome ≈ 12 lines)
  const visible = Math.max(8, height - 12);
  const top = Math.max(0, Math.min(cursor - Math.floor(visible / 2), entries.length - visible));
  const shown = entries.slice(top, top + visible);

  return (
    <box flexDirection="column">
      <text fg={theme.accent} truncate wrapMode="none">
        {tail(dir, 30)}
      </text>
      {entries.length === 0 ? (
        <text fg={theme.dim}>(no subfolders)</text>
      ) : (
        shown.map((e, i) => (
          <text key={e.path} fg={top + i === cursor ? theme.accent : theme.fg} truncate wrapMode="none">
            {top + i === cursor ? "› " : "  "}
            {e.name}/
          </text>
        ))
      )}
    </box>
  );
}
