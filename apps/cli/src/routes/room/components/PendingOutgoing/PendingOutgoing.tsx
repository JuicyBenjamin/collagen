import type { Proposal } from "@collagen/p2p";
import { outgoingSummary, proposalText } from "../../../../services/Outbox";
import { theme } from "../../../../app/theme";

/** One thing that went out, as a row: what it was, which project, who it was
 *  for when it was for a person, and what it was about. `body` is the full
 *  text, already wrapped by the caller — it knows how wide its box is and has
 *  to budget the rows it renders. Everything is flexShrink 0: a squeezed row
 *  draws its lines on top of each other. */
export function OutgoingRow({
  proposal: p,
  selected,
  expanded,
  note,
  body,
}: {
  proposal: Proposal;
  selected: boolean;
  expanded: boolean;
  note?: string;
  body?: ReadonlyArray<string>;
}) {
  const summary = outgoingSummary(p);
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={selected ? theme.accent : theme.fg} truncate wrapMode="none" flexShrink={0}>
        {selected ? (expanded ? "▾ " : "› ") : "  "}
        <span fg={theme.dim}>{summary.kind.padEnd(9)}</span>
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
      {expanded && body ? (
        <box flexDirection="column" paddingLeft={4} flexShrink={0}>
          <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
            sent {new Date(p.ts).toLocaleString()}
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
}

export const fullText = proposalText;
