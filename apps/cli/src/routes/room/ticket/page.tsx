import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { stepThreadId, type Ticket } from "@collagen/p2p";
import { diagnostics } from "../../../diagnostics";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { roomAtom } from "../../atoms";
import { identityAtom, membersAtom, rosterAtom, traceAtom } from "../atoms";
import { ticketGlyph } from "../overview/components/Tickets/Tickets";
import { ticketsAtom } from "../overview/components/Tickets/atoms";
import { runDiagnosticAtom } from "./atoms";

const STEP_GLYPH: Record<Ticket["steps"][number]["status"], string> = {
  pending: "·",
  suspended: "⟳",
  settled: "✓",
  failed: "✗",
};

/** One ticket, as a page: its steps, the conversation on its threads, and
 *  the diagnostics that apply to it. The overview is the list; this is the
 *  show. `esc` goes back to the list. */
export function TicketPage({ ticketId }: { ticketId: string }) {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  const setFocus = useAtomSet(focusAtom);
  const run = useAtomSet(runDiagnosticAtom);
  const outcome = useAtomValue(runDiagnosticAtom);
  const [stepSel, setStepSel] = useState(0);
  const [msgSel, setMsgSel] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diagSel, setDiagSel] = useState(0);

  // the cursor lands on the steps when the page opens
  useEffect(() => {
    setFocus("ticket-steps");
  }, [setFocus]);

  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    return (
      <text fg={theme.dim} marginTop={1}>
        ticket {ticketId.slice(0, 8)} is not in this room — esc goes back
      </text>
    );
  }

  const nameFor = (key: string): string =>
    key === identity?.pubkey
      ? "you"
      : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));
  const threads = new Set(ticket.steps.map((s) => stepThreadId(ticket, s)));
  const conversation = trace.filter((m) => threads.has(m.threadId));
  const ctx = { roomId, ticketId };
  const available = diagnostics.flatMap((d) => {
    const params = d.fromContext(ctx);
    return params === null ? [] : [{ d, params }];
  });
  const { glyph, color, done } = ticketGlyph(ticket);
  const sSel = clamp(stepSel, 0, Math.max(0, ticket.steps.length - 1));
  const mSel = clamp(msgSel, 0, Math.max(0, conversation.length - 1));
  const dSel = clamp(diagSel, 0, Math.max(0, available.length - 1));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1}>
      <text fg={theme.fg} truncate wrapMode="none">
        <span fg={color}>{glyph} </span>
        {ticket.goal}
        <span fg={theme.dim}>
          {" "}· {ticket.project} · by {nameFor(ticket.createdBy)} · {done}/{ticket.steps.length} settled · {ticket.id.slice(0, 8)}
        </span>
      </text>

      <Focusable
        id="ticket-steps"
        hint="↑↓ select step · ↓ past the last goes to the conversation · esc back to the list"
        flexDirection="column"
        marginTop={1}
        onKey={(key) => {
          if (key.name === "up" && sSel > 0) return setStepSel(sSel - 1), true;
          if (key.name === "down" && sSel < ticket.steps.length - 1) return setStepSel(sSel + 1), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
              {focused ? "› " : "  "}steps
            </text>
            {ticket.steps.map((s, i) => (
              <box key={s.id} flexDirection="column">
                <text fg={focused && i === sSel ? theme.accent : theme.fg} truncate wrapMode="none">
                  {focused && i === sSel ? "› " : "  "}
                  <span fg={s.status === "settled" ? theme.ok : s.status === "failed" ? theme.warn : theme.dim}>{STEP_GLYPH[s.status]}</span> {s.id}{" "}
                  {nameFor(s.owner)} · {s.intent}
                  {s.needs.length > 0 ? <span fg={theme.dim}> · needs {s.needs.join("+")}</span> : null}
                </text>
                <text fg={theme.dim} wrapMode="word">
                  {"      "}
                  {s.result ?? s.description}
                </text>
              </box>
            ))}
          </>
        )}
      </Focusable>

      <Focusable
        id="ticket-conversation"
        hint="↑↓ select message · enter full text · esc back to the list"
        flexDirection="column"
        marginTop={1}
        onKey={(key) => {
          if (key.name === "up" && mSel > 0) return setMsgSel(mSel - 1), true;
          if (key.name === "down" && mSel < conversation.length - 1) return setMsgSel(mSel + 1), true;
          if (isEnter(key)) {
            const m = conversation[mSel];
            if (m) setExpanded((e) => (e === m.id ? null : m.id));
            return true;
          }
          return false;
        }}
      >
        {(focused) => (
          <>
            <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
              {focused ? "› " : "  "}conversation
              <span fg={theme.dim}> · {conversation.length} message(s) on this ticket's threads</span>
            </text>
            {conversation.length === 0 ? (
              <text fg={theme.dim} truncate wrapMode="none">
                {"  "}nothing said yet
              </text>
            ) : (
              conversation.map((m, i) => (
                <box key={m.id} flexDirection="column">
                  <text fg={focused && i === mSel ? theme.accent : theme.fg} truncate wrapMode="none">
                    {focused && i === mSel ? "› " : "  "}
                    {nameFor(m.from)} → {nameFor(m.to)}
                    <span fg={theme.dim}> · {m.intent}</span>
                    {expanded === m.id ? null : <span fg={theme.dim}> — {m.findings.split("\n")[0]}</span>}
                  </text>
                  {expanded === m.id ? (
                    <text fg={theme.dim} wrapMode="word">
                      {"      "}
                      {m.findings}
                    </text>
                  ) : null}
                </box>
              ))
            )}
          </>
        )}
      </Focusable>

      <Focusable
        id="ticket-diagnostics"
        hint="↑↓ select · enter run · esc back to the list"
        flexDirection="column"
        marginTop={1}
        onKey={(key) => {
          if (key.name === "up" && dSel > 0) return setDiagSel(dSel - 1), true;
          if (key.name === "down" && dSel < available.length - 1) return setDiagSel(dSel + 1), true;
          if (isEnter(key)) {
            const x = available[dSel];
            if (x) run({ id: x.d.id, params: x.params, ctx });
            return true;
          }
          return false;
        }}
      >
        {(focused) => (
          <>
            <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
              {focused ? "› " : "  "}diagnostics
            </text>
            {available.map(({ d }, i) => (
              <text key={d.id} fg={focused && i === dSel ? theme.accent : theme.fg} truncate wrapMode="none">
                {focused && i === dSel ? "› " : "  "}
                {d.title}
                <span fg={theme.dim}> — {d.summary.split(". ")[0]}</span>
              </text>
            ))}
            {AsyncResult.isWaiting(outcome) ? (
              <text fg={theme.dim}>{"  "}running…</text>
            ) : AsyncResult.isSuccess(outcome) ? (
              <text fg={theme.fg} wrapMode="word">
                {"  "}
                {outcome.value}
              </text>
            ) : AsyncResult.isFailure(outcome) ? (
              <text fg={theme.warn} wrapMode="word">
                {"  "}failed: {String(outcome.cause)}
              </text>
            ) : null}
          </>
        )}
      </Focusable>
    </box>
  );
}
