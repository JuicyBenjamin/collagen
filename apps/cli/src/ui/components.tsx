import { useMemo, useState, type ReactNode } from "react";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Box, Text, useInput, useStdin } from "ink";
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

/** Filesystem folder picker — browse and select a directory (no typing).
 *  Name auto-derives from the folder; path is exact. */
export function FsPicker({
  start,
  onPick,
  onCancel,
}: {
  start: string;
  onPick: (name: string, path: string) => void;
  onCancel: () => void;
}) {
  const { isRawModeSupported } = useStdin();
  const [dir, setDir] = useState(start);
  const [cursor, setCursor] = useState(0);
  const entries = useMemo(() => listDirs(dir), [dir]);

  useInput(
    (input, key) => {
      if (key.escape) return onCancel();
      if (key.upArrow || input === "k") return setCursor((i) => Math.max(0, i - 1));
      if (key.downArrow || input === "j") return setCursor((i) => Math.min(entries.length - 1, i + 1));
      if (key.leftArrow || key.backspace) {
        setDir((d) => dirname(d));
        setCursor(0);
        return;
      }
      const e = entries[cursor];
      if (key.rightArrow || key.return) {
        if (e) {
          setDir(e.path);
          setCursor(0);
        }
        return;
      }
      if (input === " ") {
        // select the folder you're currently in
        onPick(basename(dir), dir);
      }
    },
    { isActive: isRawModeSupported },
  );

  // window the list so a big folder doesn't overflow the viewport
  const VIS = 8;
  const top = Math.max(0, Math.min(cursor - 3, entries.length - VIS));
  const shown = entries.slice(top, top + VIS);

  return (
    <Box flexDirection="column">
      <Text color={theme.accent} wrap="truncate-start">
        {dir}
      </Text>
      {entries.length === 0 ? (
        <Text color={theme.dim}>(no subfolders)</Text>
      ) : (
        shown.map((e) => {
          const i = top + shown.indexOf(e);
          return (
            <Text key={e.path} color={i === cursor ? theme.accent : theme.fg}>
              {i === cursor ? "› " : "  "}
              {e.name}/
            </Text>
          );
        })
      )}
      <Text color={theme.dim} wrap="truncate">
        ↑↓ move · → enter · ← up · space select this folder · esc cancel
      </Text>
    </Box>
  );
}

/** Minimal controlled text input (no extra deps). */
export function TextInput({
  value,
  onChange,
  onSubmit,
  focus,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  focus: boolean;
  placeholder?: string;
}) {
  const { isRawModeSupported } = useStdin();
  useInput(
    (input, key) => {
      if (key.return) return onSubmit?.();
      if (key.backspace || key.delete) return onChange(value.slice(0, -1));
      if (key.ctrl || key.meta) return;
      if (input) onChange(value + input);
    },
    { isActive: focus && isRawModeSupported },
  );
  return (
    <Text>
      {value.length ? <Text color={theme.fg}>{value}</Text> : <Text dimColor>{placeholder ?? ""}</Text>}
      {focus ? <Text color={theme.accent}>▏</Text> : null}
    </Text>
  );
}

/** Rounded, titled panel. Ink has no border title, so the title is a bold
 *  label as the panel's first line. */
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
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} minWidth={minWidth}>
      <Text bold color={color}>
        {title}
      </Text>
      {children}
    </Box>
  );
}
