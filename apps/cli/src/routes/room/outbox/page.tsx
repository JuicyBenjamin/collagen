import { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { shortRoomId } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { wrap } from "../../../lib/wrap";
import { proposalText } from "../../../services/Outbox";
import { roomAtom } from "../../atoms";
import { outboxAtom } from "../atoms";
import { PENDING_HINT, usePendingOutgoing } from "../components/PendingOutgoing/PendingOutgoing";

/** The outbox: everything of yours on its way out, in one list, newest first.
 *  Nothing here has left the machine — this page IS the gate (see the Outbox
 *  service). Proposals from every room you are in, because they are all
 *  waiting on the same person; the room is named on a row that is not from
 *  the one you are looking at. `y` sends, `n` drops, `e` rewrites first,
 *  `enter` shows the whole text. */
/** How much of an unfolded proposal to show before pointing elsewhere. */
const BODY_ROWS = 12;

export function OutboxPage() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const all = AsyncResult.getOrElse(useAtomValue(outboxAtom), () => [] as const);
  const outgoing = usePendingOutgoing();
  const setFocus = useAtomSet(focusAtom);
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
  useEffect(() => {
    setFocus("outbox");
  }, [setFocus]);

  // newest first: the thing your agent just queued is the thing you came for
  const rows = [...all].sort((a, b) => b.ts - a.ts);
  const last = Math.max(0, rows.length - 1);
  const sel = cursor === null ? 0 : clamp(cursor, 0, last);
  // An unfolded row is many lines tall. Wrap it HERE, to the width of the box
  // we measured, cap it, and take exactly those rows out of the window — an
  // estimate that came out short used to overflow the box and draw lines on
  // top of each other. `enter` again folds it; the ticket's page has the rest.
  const open = rows.find((p) => p.id === expanded);
  const wrapped = open ? wrap(proposalText(open), Math.max(20, boxWidth - 6)) : [];
  const body = wrapped.length > BODY_ROWS ? [...wrapped.slice(0, BODY_ROWS), `… ${wrapped.length - BODY_ROWS} more line(s) — the ticket's own page has all of it`] : wrapped;
  const window = Math.max(1, viewport - (open ? body.length + 1 : 0));
  const start = clamp(sel - Math.floor(window / 2), 0, Math.max(0, rows.length - window));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="outbox"
        hint={rows.length > 0 ? `${PENDING_HINT} · ↑↓ select` : "nothing waiting · ←→ switch tab"}
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
          return outgoing.onKey(key, p);
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>outbox</span>
              <span fg={rows.length > 0 ? theme.warn : theme.dim}> ({rows.length})</span>
            </text>
            <box ref={listRef} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
              {rows.length === 0 ? (
                <text fg={theme.dim} truncate wrapMode="none">
                  {"  "}nothing on its way out. Your agent queues what it wants to send here; it waits for your y
                </text>
              ) : (
                rows
                  .slice(start, start + window)
                  .map((p, i) =>
                    outgoing.row(
                      p,
                      focused && start + i === sel,
                      expanded === p.id,
                      p.roomId === roomId ? undefined : `room ${shortRoomId(p.roomId)}`,
                      body,
                    ),
                  )
              )}
            </box>
          </>
        )}
      </Focusable>
    </box>
  );
}
