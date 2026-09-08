import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { editable, proposalText } from "../../../../../services/Outbox";
import { Focusable } from "../../../../../components/Focusable";
import { captureAtom } from "../../../../../components/focus";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { clamp } from "../../../../../lib/math";
import { roomAtom } from "../../../../atoms";
import { approveOutgoingAtom, editOutgoingAtom, outboxAtom, rejectOutgoingAtom } from "../../../atoms";

const EDIT_HINT = "enter save · esc cancel — what you write here is what leaves";

/** What your agent wants to send, waiting for you. Nothing here has left the
 *  machine: `y` sends it, `n` drops it, `e` lets you rewrite it first,
 *  `enter` shows the full text. Human in the loop is the point of collagen,
 *  so the section sits at the top and never hides. */
export function Outbox() {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const all = AsyncResult.getOrElse(useAtomValue(outboxAtom), () => [] as const);
  const items = all.filter((p) => p.roomId === roomId);
  const approve = useAtomSet(approveOutgoingAtom);
  const reject = useAtomSet(rejectOutgoingAtom);
  const edit = useAtomSet(editOutgoingAtom);
  const setCaptured = useAtomSet(captureAtom);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const last = Math.max(0, items.length - 1);
  const sel = clamp(cursor, 0, last);

  const startEdit = (id: string, text: string) => {
    setEditing({ id, text });
    setCaptured(EDIT_HINT);
  };
  const stopEdit = () => {
    setEditing(null);
    setCaptured(null);
  };
  // while editing, the input owns the keys; esc is ours (the input doesn't take it)
  useKeyboard((key) => {
    if (editing && key.name === "escape") stopEdit();
  });

  return (
    <Focusable
      id="outbox"
      hint="y approve and send · n reject · e edit the text · enter full text · ↑↓ select · esc"
      flexDirection="column"
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        const p = items[sel];
        if (!p) return false;
        if (key.name === "y") return approve({ id: p.id }), true;
        if (key.name === "n") return reject({ id: p.id }), true;
        if (key.name === "e" && editable(p)) return startEdit(p.id, proposalText(p)), true;
        if (isEnter(key)) return setExpanded((e) => (e === p.id ? null : p.id)), true;
        return false;
      }}
    >
      {(focused) => (
        <>
          <text fg={focused ? theme.accent : items.length > 0 ? theme.warn : theme.dim} truncate wrapMode="none">
            {focused ? "› " : "  "}outbox
            {items.length > 0 ? <span fg={theme.warn}> · {items.length} waiting for your approval</span> : null}
          </text>
          {items.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}nothing waiting — what your agent wants to send shows here first
            </text>
          ) : (
            items.map((p, i) => {
              const text = proposalText(p);
              const isEditing = editing?.id === p.id;
              return (
                <box key={p.id} flexDirection="column">
                  <text fg={focused && i === sel ? theme.accent : theme.fg} truncate wrapMode="none">
                    {focused && i === sel ? "› " : "  "}
                    <span fg={theme.warn}>⧗ </span>
                    {p.outgoing.kind} → {p.to}
                    <span fg={theme.dim}> · {p.title}</span>
                  </text>
                  {isEditing ? (
                    <box marginLeft={6} border borderStyle="rounded" borderColor={theme.accent} paddingX={1}>
                      <input
                        focused
                        value={editing.text}
                        onInput={(t: string) => setEditing({ id: p.id, text: t })}
                        onSubmit={() => {
                          edit({ id: p.id, text: editing.text });
                          stopEdit();
                        }}
                      />
                    </box>
                  ) : expanded === p.id ? (
                    <text fg={theme.dim} wrapMode="word">
                      {"      "}
                      {text}
                    </text>
                  ) : (
                    <text fg={theme.dim} truncate wrapMode="none">
                      {"      "}
                      {text.split("\n")[0]}
                    </text>
                  )}
                </box>
              );
            })
          )}
        </>
      )}
    </Focusable>
  );
}
