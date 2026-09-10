import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { LEGEND } from "../../../../../lib/glyphs";
import { compareSummaries, peopleLabel, summarize, type TicketSummary } from "../../../../../lib/ticketSummary";
import { identityAtom, membersAtom, rosterAtom, traceAtom } from "../../../atoms";
import { ticketsAtom } from "./atoms";

/** Shared tickets — every ticket the room has, whoever made it and whoever it
 *  is for. Ordered by what wants a person: needs-you, then waiting, then
 *  failed, then done (dim) — nothing hidden or folded away. ↑↓ select, enter
 *  opens the ticket's page. The `›` is the cursor, nothing else. */
export function Tickets() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  const { navigate } = useRouter();
  const [cursor, setCursor] = useState(0);

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));

  // every ticket the room has, ordered by what wants a person
  const shown = tickets
    .map((t) => ({ t, s: summarize(t, trace, me) }))
    .sort((a, b) => compareSummaries(a.s, b.s));
  const needsYou = shown.filter((r) => r.s.state === "needs-you").length;

  const last = Math.max(0, shown.length - 1);
  const sel = clamp(cursor, 0, last);
  const current = shown[sel];

  return (
    <Focusable
      id="tickets"
      hint={`↑↓ select · enter open · ${LEGEND}`}
      flexDirection="column"
      marginTop={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key)) {
          if (current) navigate(to.ticket(current.t.id));
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <>
          <text truncate wrapMode="none" flexShrink={0}>
            <span fg={focused ? theme.accent : theme.dim}>tickets</span>
            <span fg={needsYou > 0 ? theme.warn : theme.dim}> ({shown.length})</span>
          </text>
          {shown.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none
            </text>
          ) : (
            shown.map((r, i) => <TicketRow key={r.t.id} ticket={r.t} summary={r.s} selected={focused && i === sel} nameFor={nameFor} />)
          )}
        </>
      )}
    </Focusable>
  );
}

/** One ticket at a glance: what kind it is, what it is about, and what each
 *  person on it did — `bob ✓` asked for no changes, `you ↻` asked for some,
 *  `carol ·` nothing yet (lib/glyphs, spelled out in the hint line). Nothing
 *  else: the ticket's own page has the rest, and an agent can read all of it. */
function TicketRow({
  ticket: t,
  summary: s,
  selected,
  nameFor,
}: {
  ticket: Ticket;
  summary: TicketSummary;
  selected: boolean;
  nameFor: (key: string) => string;
}) {
  const done = s.state === "done";
  return (
    <text fg={selected ? theme.accent : done ? theme.dim : theme.fg} truncate wrapMode="none">
      {selected ? "› " : "  "}
      {"  "}
      <span fg={done ? theme.dim : s.state === "failed" ? theme.warn : theme.fg}>{t.kind.padEnd(9)}</span>
      {t.goal}
      <span fg={theme.dim}> · </span>
      <span fg={s.state === "needs-you" ? theme.warn : theme.dim}>{peopleLabel(s, nameFor)}</span>
    </text>
  );
}
