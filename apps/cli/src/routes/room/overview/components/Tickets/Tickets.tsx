import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { clamp } from "../../../../../lib/math";
import { identityAtom, rosterAtom } from "../../../atoms";
import { ticketsAtom } from "./atoms";

const STEP_GLYPH: Record<Ticket["steps"][number]["status"], string> = {
  pending: "·",
  suspended: "⟳",
  settled: "✓",
  failed: "✗",
};
const SHOWN = 8;

/** Shared tickets — a section: ↑↓ select, enter shows the steps (owner,
 *  status, result). At the top edge ↑ is left for spatial navigation. */
export function Tickets() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const last = Math.max(0, tickets.length - 1);
  const sel = clamp(cursor, 0, last);
  const nameFor = (key: string): string =>
    key === identity?.pubkey ? "you" : (peers.find((p) => p.key === key)?.name ?? key.slice(0, 8));

  const shown = tickets.slice(-SHOWN);
  const firstShown = tickets.length - shown.length;

  return (
    <Focusable
      id="tickets"
      hint="↑↓ select ticket · enter details · arrows move between sections · esc"
      flexDirection="column"
      marginTop={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key)) {
          const t = tickets[sel];
          if (t) setExpanded((e) => (e === t.id ? null : t.id));
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
            shown.map((t, i) => (
              <TicketRow
                key={t.id}
                ticket={t}
                selected={focused && firstShown + i === sel}
                expanded={expanded === t.id}
                nameFor={nameFor}
              />
            ))
          )}
        </>
      )}
    </Focusable>
  );
}

function TicketRow({
  ticket: t,
  selected,
  expanded,
  nameFor,
}: {
  ticket: Ticket;
  selected: boolean;
  expanded: boolean;
  nameFor: (key: string) => string;
}) {
  const done = t.steps.filter((s) => s.status === "settled").length;
  const failed = t.steps.some((s) => s.status === "failed");
  const complete = done === t.steps.length;
  const color = selected ? theme.accent : complete ? theme.dim : theme.fg;
  return (
    <box flexDirection="column">
      <text fg={color} truncate wrapMode="none">
        {selected ? "› " : "  "}
        <span fg={complete ? theme.ok : theme.warn}>{complete ? "✓ " : failed ? "✗ " : "⧉ "}</span>
        {t.goal}
        <span fg={theme.dim}>
          {" "}· {t.project} · {done}/{t.steps.length}
        </span>
      </text>
      {expanded
        ? t.steps.map((s) => (
            <text key={s.id} fg={theme.dim} truncate wrapMode="none">
              {"      "}
              <span fg={s.status === "settled" ? theme.ok : s.status === "failed" ? theme.warn : theme.dim}>
                {STEP_GLYPH[s.status]}
              </span>{" "}
              {s.id} {nameFor(s.owner)} · {s.intent} — {s.result ?? s.description}
            </text>
          ))
        : null}
    </box>
  );
}
