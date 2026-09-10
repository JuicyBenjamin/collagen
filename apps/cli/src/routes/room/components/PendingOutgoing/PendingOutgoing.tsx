import type { Proposal } from "@collagen/p2p";
import { outgoingSummary, proposalText } from "../../../../services/Outbox";
import { theme } from "../../../../app/theme";

/** One thing that went out, as its head row: what it was, which project, who
 *  it was for when it was for a person, and what it was about. The text it
 *  carried is rendered line by line beside this (see `OutgoingLine`) so the
 *  list can scroll through a long one instead of cutting it off. Everything is
 *  flexShrink 0: a squeezed row draws its lines on top of each other. */
export function OutgoingRow({
  proposal: p,
  selected,
  expanded,
  note,
}: {
  proposal: Proposal;
  selected: boolean;
  expanded: boolean;
  note?: string;
}) {
  const summary = outgoingSummary(p);
  return (
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
  );
}

/** One line of the text a record carried, under its head row. */
export function OutgoingLine({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <text fg={dim ? theme.dim : theme.fg} truncate wrapMode="none" flexShrink={0}>
      {"    "}
      {text}
    </text>
  );
}

export const fullText = proposalText;
