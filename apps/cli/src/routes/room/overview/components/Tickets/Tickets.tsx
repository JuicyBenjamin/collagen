import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { compareSummaries, peopleLabel, summarize, type TicketSummary } from "../../../../../lib/ticketSummary";
import { roomAtom } from "../../../../atoms";
import { identityAtom, membersAtom, outboxAtom, rosterAtom, traceAtom } from "../../../atoms";
import { usePendingOutgoing } from "../../../components/PendingOutgoing/PendingOutgoing";
import { ticketsAtom } from "./atoms";

/** Shared tickets — every ticket the room has, whoever made it and whoever it
 *  is for, PLUS the ones your agent has queued and not sent yet: those are
 *  tickets too, they just have not left this machine. The queued ones sit at
 *  the top, waiting for your y; the rest are ordered by what wants a person:
 *  needs-you, then waiting, then failed, then done (dim). Nothing is hidden
 *  or folded away. Each row: state · goal · who was asked and whether they
 *  answered · age. ↑↓ select, enter opens the ticket's page, `y` / `n` send
 *  or drop a queued one. The `›` is the cursor, nothing else. */
export function Tickets() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const proposals = AsyncResult.getOrElse(useAtomValue(outboxAtom), () => [] as const);
  const outgoing = usePendingOutgoing();
  const { navigate } = useRouter();
  const [cursor, setCursor] = useState(0);

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));

  // a ticket your agent queued is a ticket: it just has not left yet
  const queued = proposals.flatMap((p) => {
    if (p.roomId !== roomId) return [];
    const t = p.outgoing.kind === "ticket" ? p.outgoing.ticket : p.outgoing.kind === "review" ? p.outgoing.ticket : undefined;
    return t ? [{ kind: "queued" as const, p, t }] : [];
  });
  const live = tickets
    .map((t) => ({ kind: "live" as const, t, s: summarize(t, trace, me) }))
    .sort((a, b) => compareSummaries(a.s, b.s));
  // queued first (they are waiting on you), then everything the room has, in
  // the order that says what wants a person; nothing folded away
  const shown = [...queued, ...live];
  const undone = live.filter((r) => r.s.state !== "done");
  const done = live.filter((r) => r.s.state === "done");
  const needsYou = live.filter((r) => r.s.state === "needs-you").length;

  const last = Math.max(0, shown.length - 1);
  const sel = clamp(cursor, 0, last);
  const current = shown[sel];

  return (
    <Focusable
      id="tickets"
      hint={
        current?.kind === "queued"
          ? "y send it · n drop it · ↑↓ select · arrows move between sections · esc"
          : "↑↓ select ticket · enter open · arrows move between sections · esc"
      }
      flexDirection="column"
      marginTop={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        // a queued ticket has no page yet — it is not on the room's log
        if (current?.kind === "queued") return outgoing.onKey(key, current.p);
        if (isEnter(key)) {
          if (current) navigate(to.ticket(current.t.id));
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <>
          <text truncate wrapMode="none">
            <span fg={focused ? theme.accent : theme.dim}>tickets</span>
            <span fg={needsYou + queued.length > 0 ? theme.warn : theme.dim}> ({shown.length})</span>
          </text>
          {shown.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none — agents create them for multi-step work
            </text>
          ) : (
            shown.map((r, i) =>
              r.kind === "queued" ? (
                <QueuedRow key={r.p.id} ticket={r.t} selected={focused && i === sel} />
              ) : (
                <TicketRow key={r.t.id} ticket={r.t} summary={r.s} selected={focused && i === sel} nameFor={nameFor} />
              ),
            )
          )}
        </>
      )}
    </Focusable>
  );
}

/** A ticket your agent wants to create, in the list with the rest and in the
 *  same shape. The `⧗` is the whole message — the app's mark for "this is
 *  yours to say yes to", the same one the outbox and a ticket's own page use.
 *  Live rows leave that column blank, so everything stays in line. */
function QueuedRow({ ticket, selected }: { ticket: Ticket; selected: boolean }) {
  return (
    <text fg={selected ? theme.accent : theme.fg} truncate wrapMode="none">
      {selected ? "› " : "  "}
      <span fg={theme.warn}>⧗ </span>
      {ticket.kind.padEnd(9)}
      {ticket.goal}
    </text>
  );
}

/** One ticket at a glance: what kind it is, what it is about, and who has
 *  answered (`bob✓` spoke or settled, `bob·` silent so far). Nothing else —
 *  the ticket's own page has the rest, and an agent can read all of it. */
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
