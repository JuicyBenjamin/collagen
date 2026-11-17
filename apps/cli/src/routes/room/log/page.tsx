import { useEffect, useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Focusable } from "../../../components/Focusable";
import { FollowScroll, type FollowScrollHandle } from "../../../components/FollowScroll";
import { focusAtom } from "../../../components/focus";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { logEntry, type LogEntry } from "../../../lib/logLine";
import { timeOf } from "../../../lib/when";
import { standingAtom } from "../atoms";
import { logsAtom } from "./atoms";

/** The log: what keeps the room from working and what to try, in full,
 *  above what this collagen has been doing — every line whole, the newest
 *  last. It stays on the newest line until the cursor is moved off it. */
export function LogPage() {
  const lines = AsyncResult.getOrElse(useAtomValue(logsAtom), () => [] as const);
  const trouble = AsyncResult.getOrElse(useAtomValue(standingAtom), () => null)?.trouble ?? null;
  // null: on the newest line, wherever that is
  const [held, setHeld] = useState<number | null>(null);
  const list = useRef<FollowScrollHandle>(null);
  const setFocus = useAtomSet(focusAtom);
  useEffect(() => {
    setFocus("log-lines");
  }, [setFocus]);

  const entries = lines.map(logEntry);
  const last = entries.length - 1;
  const sel = held === null ? last : clamp(held, 0, last);
  const at = (index: number) => {
    const to = clamp(index, 0, last);
    setHeld(to === last ? null : to);
    return true;
  };
  const page = () => Math.max(1, (list.current?.view().height ?? 10) - 1);

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      {trouble ? (
        <box flexDirection="column" flexShrink={0} marginBottom={1}>
          <text fg={theme.warn}>
            {"  "}
            {trouble.what}
          </text>
          <text fg={theme.fg}>
            {"  "}
            {trouble.next}
          </text>
        </box>
      ) : null}
      <Focusable
        id="log-lines"
        hint="↑↓ line · pgup/pgdn page · home first · end newest"
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (entries.length === 0) return false;
          if (key.name === "up" && sel > 0) return at(sel - 1);
          if (key.name === "down" && sel < last) return at(sel + 1);
          if (key.name === "pageup") return at(sel - page());
          if (key.name === "pagedown") return at(sel + page());
          if (key.name === "home") return at(0);
          if (key.name === "end") return at(last);
          return false;
        }}
      >
        {(focused) =>
          entries.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}nothing yet
            </text>
          ) : (
            <FollowScroll ref={list} follow={held === null ? "end" : { id: rowId(sel) }} flexGrow={1}>
              {entries.map((entry, index) => (
                <LogRow key={index} id={rowId(index)} entry={entry} selected={focused && index === sel} />
              ))}
            </FollowScroll>
          )
        }
      </Focusable>
    </box>
  );
}

const rowId = (index: number): string => `log-line-${index}`;

/** One line: when, in the person's own time, then what — whole, wrapped
 *  under itself; a warning or an error in the warn colour. */
function LogRow({ id, entry, selected }: { id: string; entry: LogEntry; selected: boolean }) {
  return (
    <box id={id} flexDirection="row" flexShrink={0}>
      <text fg={selected ? theme.accent : theme.dim} wrapMode="none" flexShrink={0}>
        {selected ? "› " : "  "}
        {entry.at === null ? "        " : timeOf(entry.at)}
      </text>
      <text fg={entry.trouble ? theme.warn : selected ? theme.fg : theme.dim} flexShrink={1} minWidth={0} marginLeft={2}>
        {entry.text}
      </text>
    </box>
  );
}
