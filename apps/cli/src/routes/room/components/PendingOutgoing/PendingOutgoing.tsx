import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet } from "@effect/atom-react";
import type { Proposal } from "@collagen/p2p";
import { editable, outgoingSummary, proposalText } from "../../../../services/Outbox";
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

  /** One proposal as a row. `body` is the unfolded text, already wrapped by
   *  the caller — it knows how wide its box is, and it has to budget the same
   *  number of rows it renders. Everything here is flexShrink 0: a squeezed
   *  row draws its lines on top of each other. */
  const row = (p: Proposal, selected: boolean, expanded: boolean, note?: string, body?: ReadonlyArray<string>) => {
    const isEditing = editing?.id === p.id;
    const summary = outgoingSummary(p);
    return (
      <box key={p.id} flexDirection="column" flexShrink={0}>
        {/* kind · project · who it is for · what it is about — enter has the rest */}
        <text fg={selected ? theme.accent : theme.fg} truncate wrapMode="none" flexShrink={0}>
          {selected ? (expanded ? "▾ " : "› ") : "  "}
          <span fg={theme.warn}>{summary.kind.padEnd(9)}</span>
          {summary.project ? <span fg={theme.dim}>{summary.project}/ </span> : null}
          {summary.target ? (
            <>
              <span fg={theme.dim}>→ </span>
              {summary.target}
              {"  "}
            </>
          ) : null}
          {summary.subject}
          {note ? <span fg={theme.dim}> · {note}</span> : null}
        </text>
        {isEditing ? (
          <box marginLeft={4} marginBottom={1} border borderStyle="rounded" borderColor={theme.accent} paddingX={1} flexShrink={0}>
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
        ) : expanded && body ? (
          <box flexDirection="column" paddingLeft={4} flexShrink={0}>
            <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
              queued {new Date(p.ts).toLocaleString()} · nothing has left this machine
            </text>
            {body.map((line, i) => (
              <text key={i} fg={theme.fg} truncate wrapMode="none" flexShrink={0}>
                {line}
              </text>
            ))}
          </box>
        ) : null}
      </box>
    );
  };

  return { onKey, row, editing: editing !== null } as const;
}
