import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { closedAs, epicBecause, epicParts, epicStatus, excludedFromEpic, KINDS, visibleTo, type ReviewContext, type Ticket } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { to, useRouter } from "../../../app/router";
import { clamp } from "../../../lib/math";
import { age, epicProgress, progressLabel, rowTitle, STATE_LABEL, type TicketSummary } from "../../../lib/ticketSummary";

/** An epic, as a page: a folder, not a ticket with steps.
 *    header — its goal (purple, as on the list), how far along its parts
 *             are, what an epic is, its aim
 *    parts  — every ticket that lives in it, with its project and state;
 *             enter opens one
 *    turns  — each close and reopen, by whom, and why
 *  Anyone in the room shapes it — through their agent (the epic tool), so
 *  every move and turn has its reason on the record. `esc` goes back. */
export function EpicPage({
  epic,
  all,
  why,
  summaries,
  nameFor,
  me,
}: {
  epic: Ticket;
  all: ReadonlyMap<string, Ticket>;
  why: ReviewContext | undefined;
  summaries: (t: Ticket) => TicketSummary;
  nameFor: (key: string) => string;
  /** who is reading: a ticket in it that waits on another is its author's alone */
  me: string;
}) {
  const setFocus = useAtomSet(focusAtom);
  const focus = useAtomValue(focusAtom);
  const { route, navigate } = useRouter();
  const [sel, setSel] = useState(0);
  useEffect(() => {
    if (focus !== "ticket-parts") setFocus("ticket-parts");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, [setFocus]);

  // what is in it — put there, in its reading order; the count is the
  // room's, the list only what this reader may be shown
  const { parts, lines, unresolved } = epicParts(epic, all);
  // by line of work: a piece of work's first ticket, then the stages that
  // grew out of it under it — what the progress counts
  const shownLines = lines.map((line) => line.filter((ticket) => visibleTo(ticket, all, me))).filter((line) => line.length > 0);
  const inside = shownLines.flat();
  const stageOf = new Map(shownLines.flatMap((line) => line.map((ticket, stage) => [ticket.id, { stage, last: stage === line.length - 1 }] as const)));
  const progress = epicProgress(epic, all);
  const status = epicStatus(epic, all);
  const closed = status.closed;
  // the cause said for this reader: a ticket they may not see is not named
  const because = epicBecause(status, all, me);
  const causeBy = status.cause && "by" in status.cause ? status.cause.by : undefined;
  const now = Date.now();
  const selected = clamp(sel, 0, Math.max(0, inside.length - 1));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <text truncate wrapMode="none" flexShrink={0}>
        <span fg={theme.epic}>{rowTitle(epic)}</span>
        <span fg={theme.dim}>
          {"   "}
          {closed ? "closed" : progressLabel(progress)} · {age(epic.updatedAt, now)}
        </span>
      </text>
      {epic.title && epic.goal !== epic.title ? (
        <text fg={theme.fg} wrapMode="word" flexShrink={0}>
          {"  "}
          {epic.goal}
        </text>
      ) : null}
      <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
        {"  "}
        <span fg={theme.epic}>epic</span> — {KINDS.epic.what} · started by {nameFor(epic.createdBy)}
      </text>
      {why?.summary ? (
        <text fg={theme.fg} wrapMode="word" marginTop={1} flexShrink={0}>
          {"  "}
          {why.summary}
        </text>
      ) : null}
      {!closed && parts.length > 0 && unresolved.length === 0 && !because ? (
        <text fg={theme.dim} wrapMode="word" flexShrink={0}>
          {"  "}everything in it is resolved — it can be closed
        </text>
      ) : null}
      {/* what decided its state, as the room sees it — never just the latest by clock */}
      {because ? (
        <text fg={closed ? theme.dim : theme.warn} wrapMode="word" flexShrink={0}>
          {"  "}
          {closed ? "closed" : "open"}
          {causeBy ? ` · ${nameFor(causeBy)}` : ""}: {because}
        </text>
      ) : null}

      <Focusable
        id="ticket-parts"
        hint="↑↓ select · enter opens a ticket · your agent adds, orders, excludes and takes tickets out (the epic tool) · esc back to the list"
        flexDirection="column"
        flexShrink={0}
        onKey={(key) => {
          if (key.name === "up" && selected > 0) return setSel(selected - 1), true;
          if (key.name === "down" && selected < inside.length - 1) return setSel(selected + 1), true;
          // a ticket opened from here comes back here — and from here, to wherever this epic was opened from
          const here = typeof route === "object" && route.name === "room/ticket" ? route : { name: "room/ticket" as const, ticketId: epic.id };
          if (isEnter(key) && inside[selected]) return navigate(to.ticket(inside[selected]!.id, here)), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" marginTop={2} flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>in it</span>
              <span fg={theme.dim}> · {inside.length === 0 ? "nothing yet" : `${shownLines.length} piece${shownLines.length === 1 ? "" : "s"} of work, ${inside.length} ticket${inside.length === 1 ? "" : "s"}`}</span>
            </text>
            {inside.map((ticket, index) => {
              const summary = summaries(ticket);
              const excluded = excludedFromEpic(ticket);
              return (
                <text key={ticket.id} fg={focused && index === selected ? theme.accent : summary.state === "closed" || summary.state === "done" ? theme.dim : theme.fg} truncate wrapMode="none">
                  {focused && index === selected ? "› " : "  "}
                  <span fg={theme.dim}>{(stageOf.get(ticket.id)?.stage ?? 0) === 0 ? "" : stageOf.get(ticket.id)?.last ? "└ " : "├ "}</span>
                  <span fg={theme.dim}>{ticket.kind.padEnd(9)}</span>
                  <span fg={theme.dim}>{ticket.project} · </span>
                  {ticket.title ? ticket.title : <span fg={theme.dim}>{rowTitle(ticket)}</span>}
                  <span fg={summary.state === "needs-you" ? theme.warn : theme.dim}> · {STATE_LABEL[summary.state]}</span>
                  {excluded ? <span fg={theme.dim}> · excluded from progress</span> : closedAs(ticket) === "dropped" ? <span fg={theme.dim}> · dropped</span> : null}
                </text>
              );
            })}
          </>
        )}
      </Focusable>

      {epic.turns && epic.turns.length > 0 ? (
        <>
          <text fg={theme.fg} truncate wrapMode="none" marginTop={2} flexShrink={0}>
            closed and reopened
          </text>
          {epic.turns.map((turn) => (
            <text key={`${turn.at}-${turn.by}`} fg={theme.dim} wrapMode="word" flexShrink={0}>
              {"  "}
              {turn.closed ? "closed" : "reopened"} by {nameFor(turn.by)} · {age(turn.at, now)}: {turn.reason}
            </text>
          ))}
        </>
      ) : null}
    </box>
  );
}
