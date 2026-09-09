import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { ticketsAtom } from "./atoms";

const SHOWN = 8;

/** Shared tickets — the list. ↑↓ select, enter opens the ticket's own page
 *  (steps, conversation, diagnostics). At the top edge ↑ is left for
 *  spatial navigation. */
export function Tickets() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const { navigate } = useRouter();
  const [cursor, setCursor] = useState(0);

  const last = Math.max(0, tickets.length - 1);
  const sel = clamp(cursor, 0, last);

  const shown = tickets.slice(-SHOWN);
  const firstShown = tickets.length - shown.length;

  return (
    <Focusable
      id="tickets"
      hint="↑↓ select ticket · enter open · arrows move between sections · esc"
      flexDirection="column"
      marginTop={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key)) {
          const t = tickets[sel];
          if (t) navigate(to.ticket(t.id));
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <>
          <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
            {focused ? "› " : "  "}tickets
          </text>
          {tickets.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none — agents create them for multi-step work
            </text>
          ) : (
            shown.map((t, i) => <TicketRow key={t.id} ticket={t} selected={focused && firstShown + i === sel} />)
          )}
        </>
      )}
    </Focusable>
  );
}

export function ticketGlyph(t: Ticket): { glyph: string; color: string; done: number } {
  const done = t.steps.filter((s) => s.status === "settled").length;
  const failed = t.steps.some((s) => s.status === "failed");
  const complete = done === t.steps.length;
  return { glyph: complete ? "✓" : failed ? "✗" : "⧉", color: complete ? theme.ok : theme.warn, done };
}

function TicketRow({ ticket: t, selected }: { ticket: Ticket; selected: boolean }) {
  const { glyph, color, done } = ticketGlyph(t);
  const complete = done === t.steps.length;
  return (
    <text fg={selected ? theme.accent : complete ? theme.dim : theme.fg} truncate wrapMode="none">
      {selected ? "› " : "  "}
      <span fg={color}>{glyph} </span>
      {t.goal}
      <span fg={theme.dim}>
        {" "}· {t.project} · {done}/{t.steps.length}
      </span>
    </text>
  );
}
