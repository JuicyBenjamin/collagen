import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { shortRoomId } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { FollowScroll, type FollowScrollHandle, type FollowWhat } from "../../../components/FollowScroll";
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
 *  home/end) walk through all of it however long it is. The list moves only
 *  at its edges (components/FollowScroll). Reading is a place:
 *  ← comes back out to the list instead of moving to the next tab. */
export function OutboxPage() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const all = AsyncResult.getOrElse(useAtomValue(outboxAtom), () => [] as const);
  const [cursor, setCursor] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // an opened record starts with its head line at the top, then is read by
  // hand: once scrolled, the list stays where the reader put it
  const [scrolled, setScrolled] = useState(false);
  const list = useRef<FollowScrollHandle>(null);
  const [boxWidth, setBoxWidth] = useState(80);
  const [pos, setPos] = useState({ top: 0, height: 0, total: 0 });
  const page = () => Math.max(1, list.current?.view().height ?? 10);

  const last = Math.max(0, all.length - 1);
  const sel = cursor === null ? 0 : clamp(cursor, 0, last);

  // one flat list: a head line per record, and under the unfolded one, the
  // text it carried wrapped to the box's width — so a 150-line record is
  // read to its end, not capped
  type Row = { readonly kind: "head"; readonly at: number } | { readonly kind: "line"; readonly at: number; readonly text: string; readonly dim?: boolean };
  const rows: Array<Row> = [];
  all.forEach((p, at) => {
    rows.push({ kind: "head", at });
    if (p.id !== expanded) return;
    rows.push({ kind: "line", at, text: `sent ${new Date(p.ts).toLocaleString()}`, dim: true });
    for (const text of wrap(proposalText(p), Math.max(20, boxWidth - 6))) rows.push({ kind: "line", at, text });
  });
  const open = expanded === null ? -1 : all.findIndex((p) => p.id === expanded);
  // folded: the selected record, moved only at the edges. Opened: its head at
  // the top until the reader scrolls (components/FollowScroll).
  const follow: FollowWhat = expanded !== null ? (scrolled || open < 0 ? null : { id: headId(open), how: "top" }) : sel === 0 ? "start" : { id: headId(sel) };
  const scrollable = expanded !== null && pos.total > pos.height;

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
            const fold = () => (setExpanded(null), setScrolled(false));
            // reading is a place you go into and come back out of: ← is the way
            // back to the list, not the way to the next tab. esc still leaves
            // for the tab bar, and closes the record on its way out.
            if (key.name === "left") return fold(), true;
            if (key.name === "escape") return fold(), false;
            const by = (move: () => void) => {
              setScrolled(true);
              move();
              return true;
            };
            if (key.name === "up") return by(() => list.current?.scrollBy(-1));
            if (key.name === "down") return by(() => list.current?.scrollBy(1));
            if (key.name === "pageup") return by(() => list.current?.scrollBy(-page()));
            if (key.name === "pagedown") return by(() => list.current?.scrollBy(page()));
            if (key.name === "home") return by(() => list.current?.scrollTo(0));
            if (key.name === "end") return by(() => list.current?.scrollTo(Number.MAX_SAFE_INTEGER));
            if (isEnter(key)) return fold(), true;
            return false;
          }
          const at = (n: number) => (setCursor(clamp(n, 0, last)), true);
          if (key.name === "up" && sel > 0) return at(sel - 1);
          if (key.name === "down" && sel < last) return at(sel + 1);
          if (key.name === "pageup") return at(sel - page());
          if (key.name === "pagedown") return at(sel + page());
          if (key.name === "home") return at(0);
          if (key.name === "end") return at(last);
          const p = all[sel];
          if (!p) return false;
          // opening puts that record's head line at the top, so its text reads
          // downwards from where the eye already is
          if (isEnter(key)) return setExpanded(p.id), setScrolled(false), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>outbox</span>
              {scrollable ? <span fg={theme.dim}>{` ${Math.min(pos.top + pos.height, pos.total)}/${pos.total}`}</span> : null}
            </text>
            {all.length === 0 ? (
              <text fg={theme.dim} truncate wrapMode="none">
                {"  "}none
              </text>
            ) : (
              <FollowScroll ref={list} follow={follow} onWidth={setBoxWidth} onView={setPos} flexGrow={1}>
                {rows.map((r, i) =>
                  r.kind === "head" ? (
                    <box key={`h${r.at}`} id={headId(r.at)} flexShrink={0}>
                      <OutgoingRow
                        proposal={all[r.at]!}
                        selected={focused && r.at === sel}
                        expanded={all[r.at]!.id === expanded}
                        note={all[r.at]!.roomId === roomId ? undefined : `room ${shortRoomId(all[r.at]!.roomId)}`}
                      />
                    </box>
                  ) : (
                    <OutgoingLine key={`l${i}`} text={r.text} dim={r.dim} />
                  ),
                )}
              </FollowScroll>
            )}
          </>
        )}
      </Focusable>
    </box>
  );
}

/** The id a record's head line is drawn under, so the list can keep it in view. */
const headId = (at: number): string => `outbox-${at}`;
