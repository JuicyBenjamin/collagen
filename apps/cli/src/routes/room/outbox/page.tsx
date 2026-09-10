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
import { OutgoingLine, OutgoingRow } from "../components/PendingOutgoing/PendingOutgoing";

/** The outbox: what has gone out of this machine, newest first — messages,
 *  tickets, reviews, files, from every room you are in. A record, not a
 *  queue: your agent acts when you ask it to, and this is what it did.
 *  `enter` unfolds the text it sent, whole — the rows are one flat list of
 *  head lines plus the unfolded text's own lines, so ↑↓ (and pgup/pgdn,
 *  home/end) walk through all of it however long it is. Reading is a place:
 *  ← comes back out to the list instead of moving to the next tab. */
export function OutboxPage() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const all = AsyncResult.getOrElse(useAtomValue(outboxAtom), () => [] as const);
  const [cursor, setCursor] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const listRef = useRef<BoxRenderable>(null);
  const [viewport, setViewport] = useState(10);
  const [boxWidth, setBoxWidth] = useState(80);
  useEffect(() => {
    const h = listRef.current?.height;
    if (h && h > 0 && h !== viewport) setViewport(h);
    const w = listRef.current?.width;
    if (w && w > 0 && w !== boxWidth) setBoxWidth(w);
  });

  const last = Math.max(0, all.length - 1);
  const sel = cursor === null ? 0 : clamp(cursor, 0, last);

  // one flat list: a head line per record, and under the unfolded one, the
  // text it carried wrapped to the box we measured. Windowing a flat list is
  // what lets a 150-line record be read to its end instead of capped.
  type Row = { readonly kind: "head"; readonly at: number } | { readonly kind: "line"; readonly at: number; readonly text: string; readonly dim?: boolean };
  const rows: Array<Row> = [];
  all.forEach((p, at) => {
    rows.push({ kind: "head", at });
    if (p.id !== expanded) return;
    rows.push({ kind: "line", at, text: `sent ${new Date(p.ts).toLocaleString()}`, dim: true });
    for (const text of wrap(proposalText(p), Math.max(20, boxWidth - 6))) rows.push({ kind: "line", at, text });
  });

  const maxStart = Math.max(0, rows.length - viewport);
  // unfolded: the window is yours to move, line by line. folded: it follows
  // the record you have selected.
  const start = expanded ? clamp(scroll, 0, maxStart) : clamp(sel - Math.floor(viewport / 2), 0, maxStart);
  const shown = rows.slice(start, start + viewport);
  const scrollable = expanded !== null && rows.length > viewport;

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="outbox"
        hint={
          expanded !== null
            ? "↑↓ scroll · pgup/pgdn · home/end · ← / enter back to the list"
            : all.length > 0
              ? "↑↓ select · pgup/pgdn · home/end · enter the text it sent · ←→ switch tab"
              : "←→ switch tab"
        }
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (all.length === 0) return false;
          if (expanded !== null) {
            const fold = () => (setExpanded(null), setScroll(0));
            // reading is a place you go into and come back out of: ← is the way
            // back to the list, not the way to the next tab. esc still leaves
            // for the tab bar, and closes the record on its way out.
            if (key.name === "left") return fold(), true;
            if (key.name === "escape") return fold(), false;
            const to = (n: number) => (setScroll(clamp(n, 0, maxStart)), true);
            if (key.name === "up") return to(start - 1);
            if (key.name === "down") return to(start + 1);
            if (key.name === "pageup") return to(start - viewport);
            if (key.name === "pagedown") return to(start + viewport);
            if (key.name === "home") return to(0);
            if (key.name === "end") return to(maxStart);
            if (isEnter(key)) return setExpanded(null), setScroll(0), true;
            return false;
          }
          const at = (n: number) => (setCursor(clamp(n, 0, last)), true);
          if (key.name === "up" && sel > 0) return at(sel - 1);
          if (key.name === "down" && sel < last) return at(sel + 1);
          if (key.name === "pageup") return at(sel - viewport);
          if (key.name === "pagedown") return at(sel + viewport);
          if (key.name === "home") return at(0);
          if (key.name === "end") return at(last);
          const p = all[sel];
          if (!p) return false;
          // opening puts that record's head line at the top, so its text reads
          // downwards from where the eye already is
          if (isEnter(key)) return setExpanded(p.id), setScroll(sel), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>outbox</span>
              <span fg={theme.dim}> ({all.length})</span>
              {scrollable ? <span fg={theme.dim}>{`  ${Math.min(start + viewport, rows.length)}/${rows.length}`}</span> : null}
            </text>
            <box ref={listRef} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
              {all.length === 0 ? (
                <text fg={theme.dim} truncate wrapMode="none">
                  {"  "}none
                </text>
              ) : (
                shown.map((r, i) =>
                  r.kind === "head" ? (
                    <OutgoingRow
                      key={`${start + i}`}
                      proposal={all[r.at]!}
                      selected={focused && r.at === sel}
                      expanded={all[r.at]!.id === expanded}
                      note={all[r.at]!.roomId === roomId ? undefined : `room ${shortRoomId(all[r.at]!.roomId)}`}
                    />
                  ) : (
                    <OutgoingLine key={`${start + i}`} text={r.text} dim={r.dim} />
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
