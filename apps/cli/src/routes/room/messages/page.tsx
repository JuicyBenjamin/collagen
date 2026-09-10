import { useRef, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { RoomMessage } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { roomAtom } from "../../atoms";
import { identityAtom, membersAtom, outboxAtom, rosterAtom, traceAtom } from "../atoms";
import { Arrow } from "../components/Arrow/Arrow";

type Row = { readonly kind: "msg"; readonly id: string; readonly msg: RoomMessage };

/** Messages tab: the room's agent-to-agent trace as its log has it — every
 *  message between members, in log order — and, at the bottom, what your
 *  agent wants to send and is waiting for your yes. ↑↓ scroll (follows the
 *  newest row until you scroll up), enter shows a row's full text; on a
 *  waiting row `y` sends, `e` edits, `n` drops. */
export function MessagesPage() {
  const { height } = useTerminalDimensions();
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  // null = follow the newest row until the user scrolls
  const [cursor, setCursor] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // first visible row — a ref, not state: derived from the cursor each render
  const startRef = useRef(0);

  const rows: ReadonlyArray<Row> = trace.map((msg): Row => ({ kind: "msg", id: msg.id, msg }));
  const last = Math.max(0, rows.length - 1);
  const sel = cursor === null ? last : clamp(cursor, 0, last);
  const current = rows[sel];

  const nameFor = (key: string): string =>
    key === identity?.pubkey
      ? "you"
      : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));

  // Sticky viewport: only scrolls when the cursor hits an edge, so a keypress
  // redraws one or two rows — not the whole panel.
  const window = Math.max(5, height - 16 - (expanded ? 5 : 0));
  const maxStart = Math.max(0, rows.length - window);
  let start = cursor === null ? maxStart : clamp(startRef.current, 0, maxStart);
  if (sel < start) start = sel;
  if (sel >= start + window) start = sel - window + 1;
  startRef.current = start;

  return (
    <Focusable
      id="messages"
      hint="↑↓ scroll · enter details · ↑ at the top leaves · 1/2/3 jump · esc"
      flexDirection="column"
      marginTop={1}
      flexGrow={1}
      flexShrink={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        // scrolling back to the newest row resumes following
        if (key.name === "down") return setCursor(sel >= last ? null : sel + 1), true;
        if (isEnter(key)) {
          if (current) setExpanded((e) => (e === current.id ? null : current.id));
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <>
          <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none" flexShrink={0}>
            agent-to-agent trace · who → whom · newest last
          </text>
          {rows.length === 0 ? (
            <text fg={theme.dim}>no messages yet</text>
          ) : (
            rows.slice(start, start + window).map((row, i) => (
              <MessageRow
                key={row.id}
                msg={row.msg}
                mine={row.msg.from === identity?.pubkey}
                from={nameFor(row.msg.from)}
                to={nameFor(row.msg.to)}
                selected={focused && start + i === sel}
                expanded={expanded === row.id}
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
        <Arrow from={from} to={to} mine={mine} />
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
