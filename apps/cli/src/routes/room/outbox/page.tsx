import { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { shortRoomId } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { wrap } from "../../../lib/wrap";
import { proposalText } from "../../../services/Outbox";
import { roomAtom } from "../../atoms";
import { outboxAtom } from "../atoms";
import { OutgoingRow } from "../components/PendingOutgoing/PendingOutgoing";

/** How much of an unfolded record to show before pointing elsewhere. */
const BODY_ROWS = 12;

/** The outbox: what has gone out of this machine, newest first — messages,
 *  tickets, reviews, files, from every room you are in. A record, not a
 *  queue: your agent acts when you ask it to, and this is what it did.
 *  `enter` unfolds the text it sent. */
export function OutboxPage() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const all = AsyncResult.getOrElse(useAtomValue(outboxAtom), () => [] as const);
  const [cursor, setCursor] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<BoxRenderable>(null);
  const [viewport, setViewport] = useState(10);
  const [boxWidth, setBoxWidth] = useState(80);
  useEffect(() => {
    const h = listRef.current?.height;
    if (h && h > 0 && h !== viewport) setViewport(h);
    const w = listRef.current?.width;
    if (w && w > 0 && w !== boxWidth) setBoxWidth(w);
  });

  const rows = all;
  const last = Math.max(0, rows.length - 1);
  const sel = cursor === null ? 0 : clamp(cursor, 0, last);
  // an unfolded record is many lines tall: wrapped here, to the width of the
  // box we measured, capped, and taken out of the window — so the list never
  // outgrows its box and draws over itself
  const open = rows.find((p) => p.id === expanded);
  const wrapped = open ? wrap(proposalText(open), Math.max(20, boxWidth - 6)) : [];
  const body = wrapped.length > BODY_ROWS ? [...wrapped.slice(0, BODY_ROWS), `… ${wrapped.length - BODY_ROWS} more line(s)`] : wrapped;
  const window = Math.max(1, viewport - (open ? body.length + 1 : 0));
  const start = clamp(sel - Math.floor(window / 2), 0, Math.max(0, rows.length - window));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="outbox"
        hint={rows.length > 0 ? "↑↓ select · enter the text it sent · ←→ switch tab" : "←→ switch tab"}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (rows.length === 0) return false;
          if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
          if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
          const p = rows[sel];
          if (!p) return false;
          if (isEnter(key)) return setExpanded((x) => (x === p.id ? null : p.id)), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>outbox</span>
              <span fg={theme.dim}> ({rows.length})</span>
            </text>
            <box ref={listRef} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
              {rows.length === 0 ? (
                <text fg={theme.dim} truncate wrapMode="none">
                  {"  "}none
                </text>
              ) : (
                rows
                  .slice(start, start + window)
                  .map((p, i) => (
                    <OutgoingRow
                      key={p.id}
                      proposal={p}
                      selected={focused && start + i === sel}
                      expanded={expanded === p.id}
                      note={p.roomId === roomId ? undefined : `room ${shortRoomId(p.roomId)}`}
                      body={body}
                    />
                  ))
              )}
            </box>
          </>
        )}
      </Focusable>
    </box>
  );
}
