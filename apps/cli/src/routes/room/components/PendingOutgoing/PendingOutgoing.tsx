import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet } from "@effect/atom-react";
import type { Proposal } from "@collagen/p2p";
import { editable, proposalText } from "../../../../services/Outbox";
import { captureAtom } from "../../../../components/focus";
import type { Key } from "../../../../components/keys";
import { theme } from "../../../../app/theme";
import { approveOutgoingAtom, editOutgoingAtom, rejectOutgoingAtom } from "../../atoms";

export const PENDING_HINT = "y approve and send · e edit the text · n reject · enter full text";
const EDIT_HINT = "enter save · esc cancel — what you write here is what leaves";

/** What your agent wants to send, waiting for you — rows at the bottom of a
 *  message list, one per proposal. Nothing here has left the machine: `y`
 *  sends it, `n` drops it, `e` lets you rewrite it first. One hook gives a
 *  list its key handling and its row renderer. */
export function usePendingOutgoing() {
  const approve = useAtomSet(approveOutgoingAtom);
  const reject = useAtomSet(rejectOutgoingAtom);
  const edit = useAtomSet(editOutgoingAtom);
  const setCaptured = useAtomSet(captureAtom);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const stopEdit = () => {
    setEditing(null);
    setCaptured(null);
  };
  // while editing, the input owns the keys; esc is ours (the input doesn't take it)
  useKeyboard((key) => {
    if (editing && key.name === "escape") stopEdit();
  });

  const onKey = (key: Key, p: Proposal): boolean => {
    if (key.name === "y") return approve({ id: p.id }), true;
    if (key.name === "n") return reject({ id: p.id }), true;
    if (key.name === "e" && editable(p)) {
      setEditing({ id: p.id, text: proposalText(p) });
      setCaptured(EDIT_HINT);
      return true;
    }
    return false;
  };

  const row = (p: Proposal, selected: boolean, expanded: boolean) => {
    const text = proposalText(p);
    const isEditing = editing?.id === p.id;
    return (
      <box key={p.id} flexDirection="column">
        <text fg={selected ? theme.accent : theme.fg} truncate wrapMode="none">
          {selected ? (expanded ? "▾ " : "› ") : "  "}
          <span fg={theme.warn}>⧗ </span>
          <span fg={theme.accent}>you</span>
          <span fg={theme.dim}> → {p.to}</span>
          <span fg={theme.dim}> [{p.title}] </span>
          {expanded || isEditing ? <span fg={theme.warn}>waiting for your y / n</span> : text.split("\n")[0]}
        </text>
        {isEditing ? (
          <box marginLeft={4} marginBottom={1} border borderStyle="rounded" borderColor={theme.accent} paddingX={1}>
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
        ) : expanded ? (
          <box flexDirection="column" paddingLeft={4} marginBottom={1}>
            <text fg={theme.dim} truncate wrapMode="none">
              {p.outgoing.kind} · proposed {new Date(p.ts).toLocaleString()} · nothing has left yet
            </text>
            <text fg={theme.fg} wrapMode="word">
              {text}
            </text>
          </box>
        ) : null}
      </box>
    );
  };

  return { onKey, row, editing: editing !== null } as const;
}
