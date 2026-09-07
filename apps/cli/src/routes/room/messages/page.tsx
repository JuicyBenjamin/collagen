import { useRef, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { RoomMessage } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { identityAtom, membersAtom, rosterAtom, traceAtom } from "../atoms";

/** Messages tab: the room's agent-to-agent trace as its log has it — every
 *  message between members, in log order. A logging view — the person reads
 *  what their AI tells them; this is for seeing what the agents said to each
 *  other. ↑↓ scroll (follows the newest message until you scroll up), enter
 *  shows a message's full text. */
export function MessagesPage() {
  const { height } = useTerminalDimensions();
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  // null = follow the newest message until the user scrolls
  const [cursor, setCursor] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // first visible row — a ref, not state: derived from the cursor each render
  const startRef = useRef(0);

  const last = Math.max(0, trace.length - 1);
  const sel = cursor === null ? last : clamp(cursor, 0, last);

  const nameFor = (key: string): string =>
    key === identity?.pubkey
      ? "you"
      : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));

  // Sticky viewport: only scrolls when the cursor hits an edge, so a keypress
  // redraws one or two rows — not the whole panel.
  const window = Math.max(5, height - 16 - (expanded ? 5 : 0));
  const maxStart = Math.max(0, trace.length - window);
  let start = cursor === null ? maxStart : clamp(startRef.current, 0, maxStart);
  if (sel < start) start = sel;
  if (sel >= start + window) start = sel - window + 1;
  startRef.current = start;

  return (
    <Focusable
      id="messages"
      hint="↑↓ scroll · enter details · ↑ at the top leaves · 1/2 jump · esc"
      flexDirection="column"
      marginTop={1}
      flexGrow={1}
      flexShrink={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        // scrolling back to the newest message resumes following
        if (key.name === "down") return setCursor(sel >= last ? null : sel + 1), true;
        if (isEnter(key)) {
          const m = trace[sel];
          if (m) setExpanded((e) => (e === m.id ? null : m.id));
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <>
          <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
            agent-to-agent trace · who → whom · newest last
          </text>
          {trace.length === 0 ? (
            <text fg={theme.dim}>no messages yet</text>
          ) : (
            trace.slice(start, start + window).map((msg, i) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                mine={msg.from === identity?.pubkey}
                from={nameFor(msg.from)}
                to={nameFor(msg.to)}
                selected={focused && start + i === sel}
                expanded={expanded === msg.id}
              />
            ))
          )}
        </>
      )}
    </Focusable>
  );
}

function MessageRow({
  msg,
  mine,
  from,
  to,
  selected,
  expanded,
}: {
  msg: RoomMessage;
  mine: boolean;
  from: string;
  to: string;
  selected: boolean;
  expanded: boolean;
}) {
  return (
    <box flexDirection="column">
      <text fg={selected ? theme.accent : theme.fg} truncate wrapMode="none">
        {selected ? (expanded ? "▾ " : "› ") : "  "}
        <span fg={mine ? theme.accent : theme.warn}>
          {from} → {to}
        </span>
        <span fg={theme.dim}>
          {" "}[{msg.project}/{msg.intent}]{" "}
        </span>
        {msg.findings}
      </text>
      {expanded ? (
        <box flexDirection="column" paddingLeft={4} marginBottom={1}>
          <text fg={theme.dim} truncate wrapMode="none">
            thread {msg.threadId} · {new Date(msg.ts).toLocaleString()}
          </text>
          <text fg={theme.fg}>{msg.findings}</text>
        </box>
      ) : null}
    </box>
  );
}
