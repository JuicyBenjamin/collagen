import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { RoomMessage } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { FollowScroll, type FollowScrollHandle } from "../../../components/FollowScroll";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { roomAtom } from "../../atoms";
import { identityAtom, membersAtom, rosterAtom, traceAtom } from "../atoms";
import { Arrow } from "../components/Arrow/Arrow";

type Row = { readonly kind: "msg"; readonly id: string; readonly msg: RoomMessage };

/** Messages tab: the room's agent-to-agent trace as its log has it — every
 *  message between members, in log order. ↑↓ scroll (follows the newest row
 *  until you scroll up; the list moves only at its edges), enter shows a
 *  row's full text. It is a trace, not a
 *  queue: nothing here waits for the person, so nothing counts it. */
export function MessagesPage() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  // null = follow the newest row until the user scrolls
  const [cursor, setCursor] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useRef<FollowScrollHandle>(null);
  // details just opened start at their header; once the reader moves through
  // them they stay where the reader put them
  const [reading, setReading] = useState(false);

  const rows: ReadonlyArray<Row> = trace.map((msg): Row => ({ kind: "msg", id: msg.id, msg }));
  const last = Math.max(0, rows.length - 1);
  const sel = cursor === null ? last : clamp(cursor, 0, last);
  const current = rows[sel];

  const nameFor = (key: string): string =>
    key === identity?.pubkey
      ? "you"
      : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));


  return (
    <Focusable
      id="messages"
      hint="↑↓ scroll · enter details · ↑ at the top leaves · 1/2/3 jump · esc"
      flexDirection="column"
      marginTop={1}
      flexGrow={1}
      flexShrink={1}
      onKey={(key) => {
        // an unfolded message taller than the list is read first: ↑↓ move
        // through its text, and on to the next message only at its ends
        const open = current && expanded === current.id ? list.current?.rowOf(msgRowId(current.id)) : null;
        const view = list.current?.view();
        if (open && view && open.size > view.height) {
          if (key.name === "down" && view.top + view.height < open.at + open.size) return setReading(true), list.current?.scrollBy(1), true;
          if (key.name === "up" && view.top > open.at) return setReading(true), list.current?.scrollBy(-1), true;
        }
        if (key.name === "up" && sel > 0) return setReading(false), setCursor(sel - 1), true;
        // scrolling back to the newest row resumes following
        if (key.name === "down") return setReading(false), setCursor(sel >= last ? null : sel + 1), true;
        if (isEnter(key)) {
          if (current) setExpanded((e) => (e === current.id ? null : current.id));
          // opened details hold the cursor on their message: one that arrives
          // while they are read does not take it — following the newest
          // resumes only by moving past the last row
          setCursor(sel);
          setReading(false);
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
            // the newest row followed until the user scrolls; then the cursor's,
            // moved only at the edges (components/FollowScroll)
            <FollowScroll ref={list} follow={cursor === null && expanded === null ? "end" : current ? { id: msgRowId(current.id), how: expanded === current.id && !reading ? "top" : "edge" } : null} flexGrow={1}>
              {rows.map((row, i) => (
                <MessageRow
                  key={row.id}
                  id={msgRowId(row.id)}
                  msg={row.msg}
                  mine={row.msg.from === identity?.pubkey}
                  from={nameFor(row.msg.from)}
                  to={nameFor(row.msg.to)}
                  selected={focused && i === sel}
                  expanded={expanded === row.id}
                />
              ))}
            </FollowScroll>
          )}
        </>
      )}
    </Focusable>
  );
}

/** The id a message's row is drawn under, so the list can keep it in view. */
const msgRowId = (id: string): string => `msg-${id}`;

function MessageRow({
  id,
  msg,
  mine,
  from,
  to,
  selected,
  expanded,
}: {
  id: string;
  msg: RoomMessage;
  mine: boolean;
  from: string;
  to: string;
  selected: boolean;
  expanded: boolean;
}) {
  return (
    <box id={id} flexDirection="column" flexShrink={0}>
      <text fg={selected ? theme.accent : theme.fg} truncate wrapMode="none">
        {selected ? (expanded ? "▾ " : "› ") : "  "}
        <Arrow from={from} to={to} mine={mine} />
        <span fg={theme.dim}>
          {" "}[{msg.project}/{msg.intent}]{" "}
        </span>
        {msg.findings.split("\n")[0]}
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
