import { isClosed, ticketName, type Ticket as TicketRecord } from "@collagen/p2p";
import { theme } from "../../../../../../app/theme";
import { KIND_GLYPH } from "../../../../../../lib/glyphs";

/** The name column under a merge: eight letters and a space. */
const NAME = 9;

/** A ticket a merge came from, on the merge's tree: its kind, whose it is,
 *  its title — dim once closed. */
export function Ticket({ id, ticket, last, author, mine, selected }: { id: string; ticket: TicketRecord; last: boolean; author: string; mine: boolean; selected: boolean }) {
  const color = selected ? theme.accent : isClosed(ticket) ? theme.dim : theme.fg;
  return (
    <box id={id} flexDirection="row" flexShrink={0}>
      <text fg={color} wrapMode="none" flexShrink={0}>
        {selected ? "  › " : "    "}
        <span fg={theme.dim}>{last ? "└ " : "├ "}</span>
        <span fg={theme.dim}>{ticket.kind === "epic" ? "  " : `${KIND_GLYPH[ticket.kind]} `}</span>
        <span fg={mine ? theme.accent : theme.dim}>{author.slice(0, NAME - 1).padEnd(NAME)}</span>
      </text>
      <text fg={color} truncate wrapMode="none" flexShrink={1} minWidth={0}>
        {ticketName(ticket)}
      </text>
    </box>
  );
}
