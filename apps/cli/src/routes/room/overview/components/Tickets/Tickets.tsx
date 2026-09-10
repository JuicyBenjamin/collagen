import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { age, compareSummaries, peopleLabel, STATE_LABEL, summarize, type TicketState, type TicketSummary } from "../../../../../lib/ticketSummary";
import { identityAtom, membersAtom, rosterAtom, traceAtom } from "../../../atoms";
import { ticketsAtom } from "./atoms";

/** How many done/failed tickets to show before folding the rest. */
const DONE_SHOWN = 3;

/** Shared tickets — the list, for a person who wants to know what wants
 *  them. Each row: state · goal · who was asked and whether they answered ·
 *  age. Needs-you first, then waiting, then failed, then done (dim, folded
 *  past a few). ↑↓ select, enter opens the ticket's page. The `›` is the
 *  cursor, nothing else. */
export function Tickets() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  const { navigate } = useRouter();
  const [cursor, setCursor] = useState(0);
  const [unfolded, setUnfolded] = useState(false);

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));
  const now = Date.now();

  const rows = tickets
    .map((t) => ({ t, s: summarize(t, trace, me) }))
    .sort((a, b) => compareSummaries(a.s, b.s));
  // every ticket in the room that is not finished, whoever made it and
  // whoever it is for — a failed one is unfinished, not history
  const undone = rows.filter((r) => r.s.state !== "done");
  const done = rows.filter((r) => r.s.state === "done");
  const shownDone = unfolded ? done : done.slice(0, DONE_SHOWN);
  const folded = done.length - shownDone.length;
  const shown = [...undone, ...shownDone];
  const needsYou = rows.filter((r) => r.s.state === "needs-you").length;
  const projects = new Set(tickets.map((t) => t.project));
  const showProject = projects.size > 1;

  // the fold row is selectable too: enter unfolds
  const last = Math.max(0, shown.length - (folded > 0 ? 0 : 1));
  const sel = clamp(cursor, 0, last);

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
          const r = shown[sel];
          if (r) navigate(to.ticket(r.t.id));
          else if (folded > 0) setUnfolded(true);
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <>
          <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
            tickets
            {tickets.length > 0 ? (
              <span fg={theme.dim}>
                {" "}·{" "}
                {needsYou > 0 ? <span fg={theme.warn}>{needsYou} need{needsYou === 1 ? "s" : ""} you · </span> : null}
                {undone.length - needsYou} in flight · {done.length} done
              </span>
            ) : null}
          </text>
          {tickets.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none — agents create them for multi-step work
            </text>
          ) : (
            <>
              {shown.map((r, i) => (
                <TicketRow key={r.t.id} ticket={r.t} summary={r.s} selected={focused && i === sel} nameFor={nameFor} now={now} showProject={showProject} />
              ))}
              {folded > 0 ? (
                <text fg={focused && sel === shown.length ? theme.accent : theme.dim} truncate wrapMode="none">
                  {focused && sel === shown.length ? "› " : "  "}… {folded} more done
                </text>
              ) : null}
            </>
          )}
        </>
      )}
    </Focusable>
  );
}

const STATE_COLOR: Record<TicketState, string> = { "needs-you": theme.warn, waiting: theme.fg, failed: theme.warn, done: theme.dim };

function TicketRow({
  ticket: t,
  summary: s,
  selected,
  nameFor,
  now,
  showProject,
}: {
  ticket: Ticket;
  summary: TicketSummary;
  selected: boolean;
  nameFor: (key: string) => string;
  now: number;
  showProject: boolean;
}) {
  const closed = s.state === "done" || s.state === "failed";
  const stateText = s.state === "waiting" ? `waiting on ${s.waitingOn.map(nameFor).join(", ")}` : STATE_LABEL[s.state];
  return (
    <text fg={selected ? theme.accent : closed ? theme.dim : theme.fg} truncate wrapMode="none">
      {selected ? "› " : "  "}
      <span fg={STATE_COLOR[s.state]}>{stateText.padEnd(16)}</span>
      {t.goal}
      <span fg={theme.dim}>
        {showProject ? ` · ${t.project}` : ""} · {peopleLabel(s, nameFor)} · {age(s.lastActivity, now)}
      </span>
    </text>
  );
}
