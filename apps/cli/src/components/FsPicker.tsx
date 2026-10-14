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
      .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
      .map((dirent) => ({ name: dirent.name, path: join(dir, dirent.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Keep the tail of a path visible (truncate-start). */
function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-(max - 1))}` : text;
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
    if (key.name === "up" || key.name === "k") return setCursor((previous) => Math.max(0, previous - 1));
    if (key.name === "down" || key.name === "j") return setCursor((previous) => Math.min(entries.length - 1, previous + 1));
    if (key.name === "left" || key.name === "backspace") {
      setDir((previous) => dirname(previous));
      setCursor(0);
      return;
    }
    if (key.name === "right") {
      const entry = entries[cursor];
      if (entry) {
        setDir(entry.path);
        setCursor(0);
      }
      return;
    }
    if (isEnter(key)) {
      // enter picks the highlighted folder; in an empty dir it picks the
      // folder you're standing in
      const entry = entries[cursor];
      if (entry) return onPick(entry.name, entry.path);
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
        shown.map((entry, index) => (
          <text key={entry.path} fg={top + index === cursor ? theme.accent : theme.fg} truncate wrapMode="none">
            {top + index === cursor ? "› " : "  "}
            {entry.name}/
          </text>
        ))
      )}
    </box>
  );
}
