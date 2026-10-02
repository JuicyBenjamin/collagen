import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { epicParts, epicStatus, excludedFromEpic, KINDS, visibleTo, type ReviewContext, type Ticket } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { to, useRouter } from "../../../app/router";
import { clamp } from "../../../lib/math";
import { age, epicProgress, progressLabel, STATE_LABEL, type TicketSummary } from "../../../lib/ticketSummary";

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
  const { navigate } = useRouter();
  const [sel, setSel] = useState(0);
  useEffect(() => {
    if (focus !== "ticket-parts") setFocus("ticket-parts");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, [setFocus]);

  // what is in it — put there, in its reading order; the count is the
  // room's, the list only what this reader may be shown
  const { parts, unresolved } = epicParts(epic, all);
  const inside = parts.filter((t) => visibleTo(t, all, me));
  const progress = epicProgress(epic, all);
  const status = epicStatus(epic, all);
  const closed = status.closed;
  const now = Date.now();
  const s = clamp(sel, 0, Math.max(0, inside.length - 1));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <text truncate wrapMode="none" flexShrink={0}>
        <span fg={theme.epic}>{epic.goal}</span>
        <span fg={theme.dim}>
          {"   "}
          {closed ? "closed" : progressLabel(progress)} · {age(epic.updatedAt, now)}
        </span>
      </text>
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
      {!closed && parts.length > 0 && unresolved.length === 0 && !status.because ? (
        <text fg={theme.dim} wrapMode="word" flexShrink={0}>
          {"  "}everything in it is resolved — it can be closed
        </text>
      ) : null}
      {/* what decided its state, as the room sees it — never just the latest by clock */}
      {status.because ? (
        <text fg={closed ? theme.dim : theme.warn} wrapMode="word" flexShrink={0}>
          {"  "}
          {closed ? "closed" : "open"}
          {status.by ? ` · ${nameFor(status.by)}` : ""}: {status.because}
        </text>
      ) : null}

      <Focusable
        id="ticket-parts"
        hint="↑↓ select · enter opens a ticket · your agent adds, orders, excludes and takes tickets out (the epic tool) · esc back to the list"
        flexDirection="column"
        flexShrink={0}
        onKey={(key) => {
          if (key.name === "up" && s > 0) return setSel(s - 1), true;
          if (key.name === "down" && s < inside.length - 1) return setSel(s + 1), true;
          if (isEnter(key) && inside[s]) return navigate(to.ticket(inside[s]!.id)), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" marginTop={2} flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>in it</span>
              <span fg={theme.dim}> · {inside.length === 0 ? "nothing yet" : `${inside.length} ticket${inside.length === 1 ? "" : "s"}`}</span>
            </text>
            {inside.map((t, i) => {
              const st = summaries(t);
              const excluded = excludedFromEpic(t);
              return (
                <text key={t.id} fg={focused && i === s ? theme.accent : st.state === "closed" || st.state === "done" ? theme.dim : theme.fg} truncate wrapMode="none">
                  {focused && i === s ? "› " : "  "}
                  <span fg={theme.dim}>{t.kind.padEnd(9)}</span>
                  <span fg={theme.dim}>{t.project} · </span>
                  {t.goal}
                  <span fg={st.state === "needs-you" ? theme.warn : theme.dim}> · {STATE_LABEL[st.state]}</span>
                  {excluded ? <span fg={theme.dim}> · excluded from progress</span> : null}
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
          {epic.turns.map((t) => (
            <text key={`${t.at}-${t.by}`} fg={theme.dim} wrapMode="word" flexShrink={0}>
              {"  "}
              {t.closed ? "closed" : "reopened"} by {nameFor(t.by)} · {age(t.at, now)}: {t.reason}
            </text>
          ))}
        </>
      ) : null}
    </box>
  );
}
