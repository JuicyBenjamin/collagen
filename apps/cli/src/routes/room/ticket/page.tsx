import { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Ticket } from "@collagen/p2p";
import { diagnostics } from "../../../diagnostics";
import { aboutTicket, age, peopleLabel, STATE_LABEL, summarize, ticketThreads } from "../../../lib/ticketSummary";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { to, useRouter } from "../../../app/router";
import { roomAtom } from "../../atoms";
import { attachmentsAtom, fetchAttachmentAtom, heldAttachmentsAtom, identityAtom, membersAtom, outboxAtom, reviewsAtom, rosterAtom, traceAtom } from "../atoms";
import { reviewHeadline } from "../../../lib/review";
import { Arrow } from "../components/Arrow/Arrow";
import { wrap } from "../../../lib/wrap";
import { ticketsAtom } from "../overview/components/Tickets/atoms";
import { runDiagnosticAtom } from "./atoms";

/** A section title. Space does the chunking — two blank lines above, no
 *  box, no rule — and the title sits at the margin while its rows indent. */
function SectionTitle({ title, note, focused }: { title: string; note?: string; focused: boolean }) {
  return (
    <text truncate wrapMode="none" marginTop={2} flexShrink={0}>
      <span fg={focused ? theme.accent : theme.fg}>{title}</span>
      {note ? <span fg={theme.dim}> · {note}</span> : null}
    </text>
  );
}


const STEP_GLYPH: Record<Ticket["steps"][number]["status"], string> = {
  pending: "·",
  suspended: "⟳",
  settled: "✓",
  failed: "✗",
};

/** One ticket, as a page.
 *    header  — the meta: goal, state, project, who made it, who is in it
 *    body    — steps; attachments (files on the ticket, if any); conversation
 *    foot    — diagnostics, one row, tucked away
 *  The overview is the list; this is the show. `esc` goes back. */
export function TicketPage({ ticketId }: { ticketId: string }) {
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  const allAttachments = AsyncResult.getOrElse(useAtomValue(attachmentsAtom), () => [] as const);
  const reviews = AsyncResult.getOrElse(useAtomValue(reviewsAtom), () => [] as const);
  const held = AsyncResult.getOrElse(useAtomValue(heldAttachmentsAtom), () => ({}) as Record<string, string>);
  const fetch = useAtomSet(fetchAttachmentAtom);
  const fetchOutcome = useAtomValue(fetchAttachmentAtom);
  const setFocus = useAtomSet(focusAtom);
  const focus = useAtomValue(focusAtom);
  const { navigate } = useRouter();
  const { width } = useTerminalDimensions();
  // the conversation box takes what the layout leaves between steps and the
  // foot; after each layout we read how many rows that is — never an estimate
  const convRef = useRef<BoxRenderable>(null);
  const [convHeight, setConvHeight] = useState(8);
  useEffect(() => {
    const h = convRef.current?.height;
    if (h && h > 0 && h !== convHeight) setConvHeight(h);
  });
  const run = useAtomSet(runDiagnosticAtom);
  const outcome = useAtomValue(runDiagnosticAtom);
  const [stepSel, setStepSel] = useState(0);
  const [msgSel, setMsgSel] = useState<number | null>(null);
  const [diagSel, setDiagSel] = useState(0);
  const [attSel, setAttSel] = useState(0);

  // the cursor lands on the steps when the page opens — unless we came back
  // from a page of ours (transcripts), which put it where it left from
  useEffect(() => {
    if (!focus.startsWith("ticket-")) setFocus("ticket-steps");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, [setFocus]);

  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    return (
      <text fg={theme.dim} marginTop={1}>
        ticket {ticketId.slice(0, 8)} is not in this room — esc goes back
      </text>
    );
  }

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));
  const review = reviews.find((r) => r.ticketId === ticket.id);
  const threads = ticketThreads(ticket);
  const conversation = trace.filter((m) => aboutTicket(ticket, threads, m));
  const summary = summarize(ticket, trace, me);
  const now = Date.now();
  const rows = conversation.map((m) => ({ kind: "msg" as const, id: m.id, m }));
  // files attached to this ticket: references from the log; the file is here
  // once fetched (or when we attached it)
  const attachments = allAttachments.filter((a) => a.ticketId === ticket.id);
  const online = (key: string) => key === me || peers.some((p) => p.key === key);
  const aSel = clamp(attSel, 0, Math.max(0, attachments.length - 1));
  const fetchNote = AsyncResult.isSuccess(fetchOutcome) ? fetchOutcome.value : AsyncResult.isFailure(fetchOutcome) ? `failed: ${String(fetchOutcome.cause)}` : "";
  // every row in full: a head line (who → whom · intent) then its text, wrapped
  const textWidth = Math.max(30, width - 30);
  const lines = rows.flatMap((r, row) => {
    const head = (
      <>
        <Arrow from={nameFor(r.m.from)} to={nameFor(r.m.to)} mine={r.m.from === me} />
        <span fg={theme.dim}> · {r.m.intent}</span>
      </>
    );
    const text = r.m.findings;
    return [{ kind: "head" as const, row, head, text: "" }, ...wrap(text, textWidth).map((t) => ({ kind: "body" as const, row, head: null, text: t }))];
  });
  const firstLineOf = (row: number) => lines.findIndex((l) => l.row === row);
  const ctx = { roomId, ticketId };
  const available = diagnostics.flatMap((d) => {
    const params = d.fromContext(ctx);
    return params === null ? [] : [{ d, params }];
  });
  const done = ticket.steps.filter((s) => s.status === "settled").length;
  // the other people on it and what each did; the reader is not in the list
  const people = peopleLabel(summary, nameFor);
  const glyph = summary.state === "done" ? "✓" : summary.state === "failed" ? "✗" : "⧉";
  const glyphColor = summary.state === "done" ? theme.ok : theme.warn;
  const stateText = summary.state === "waiting" ? `waiting on ${summary.waitingOn.map(nameFor).join(", ")}` : STATE_LABEL[summary.state];
  const sSel = clamp(stepSel, 0, Math.max(0, ticket.steps.length - 1));
  const mSel = msgSel === null ? Math.max(0, rows.length - 1) : clamp(msgSel, 0, Math.max(0, rows.length - 1));
  const dSel = clamp(diagSel, 0, Math.max(0, available.length - 1));
  const currentRow = rows[mSel];
  const CONVERSATION_HEIGHT = Math.max(1, convHeight);
  const maxStart = Math.max(0, lines.length - CONVERSATION_HEIGHT);
  const headLine = Math.max(0, firstLineOf(mSel));
  const lineStart = msgSel === null ? maxStart : clamp(Math.min(headLine, maxStart), 0, maxStart);

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      {/* header: the meta */}
      <text truncate wrapMode="none" flexShrink={0}>
        <span fg={glyphColor}>{glyph} </span>
        <span fg={theme.fg}>{ticket.goal}</span>
        <span fg={summary.state === "needs-you" ? theme.warn : theme.dim}>
          {"   "}{stateText}
        </span>
        <span fg={theme.dim}> · {age(summary.lastActivity, now)}</span>
      </text>
      <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
        {"  "}
        {ticket.project} · by {nameFor(ticket.createdBy)} · {done}/{ticket.steps.length} settled
        {people.length > 0 ? ` · ${people}` : ""}
      </text>

      {/* body: why — a review ticket carries the reasons behind the change.
          The headline here, the whole of it one enter away. */}
      {review ? (
        <Focusable
          id="ticket-review"
          hint="enter reads the why — every decision, how it was steered, and the forks · esc back to the list"
          flexDirection="column"
          flexShrink={0}
          onKey={(key) => (isEnter(key) ? (navigate(to.review(ticketId, to.ticket(ticketId))), true) : false)}
        >
          {(focused) => (
            <>
              <SectionTitle title="why" note={`${reviewHeadline(review, { link: false })} · updated ${age(review.ts, now)}`} focused={focused} />
              <text fg={theme.dim} wrapMode="word">
                {"  "}
                {review.summary}
              </text>
              <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
                {"  "}enter reads it · by {nameFor(review.author)}
              </text>
            </>
          )}
        </Focusable>
      ) : null}

      {/* body: steps */}
      <box flexShrink={0}>
        <Focusable
          id="ticket-steps"
          hint="↑↓ select step · ↓ past the last goes to the conversation · esc back to the list"
          flexDirection="column"
          flexGrow={1}
          flexShrink={0}
          onKey={(key) => {
            if (key.name === "up" && sSel > 0) return setStepSel(sSel - 1), true;
            if (key.name === "down" && sSel < ticket.steps.length - 1) return setStepSel(sSel + 1), true;
            return false;
          }}
        >
          {(focused) => (
            <>
              <SectionTitle title="steps" note={`${done}/${ticket.steps.length} settled`} focused={focused} />
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
      </box>

      {/* body: attachments — files on this ticket, fetched or not. Only when
          there are any. y fetches from the holder (both online); enter reads a
          fetched transcript; other files are yours to open at their path. */}
      {attachments.length > 0 ? (
        <Focusable
          id="ticket-attachments"
          hint="↑↓ select · y fetch the file from its holder · enter read a fetched transcript · esc back to the list"
          flexDirection="column"
          flexShrink={0}
          onKey={(key) => {
            if (key.name === "up" && aSel > 0) return setAttSel(aSel - 1), true;
            if (key.name === "down" && aSel < attachments.length - 1) return setAttSel(aSel + 1), true;
            const a = attachments[aSel];
            if (!a) return false;
            if (key.name === "y" && !held[a.id]) return fetch({ roomId, attachmentId: a.id }), true;
            if (isEnter(key)) {
              const file = held[a.id];
              if (file && a.transcript) navigate(to.transcript(file, a.name, to.ticket(ticketId)));
              else if (!file) fetch({ roomId, attachmentId: a.id });
              return true;
            }
            return false;
          }}
        >
          {(focused) => (
            <>
              <SectionTitle title="attachments" note={`${attachments.length} file${attachments.length === 1 ? "" : "s"}${fetchNote ? ` · ${fetchNote}` : ""}`} focused={focused} />
              {attachments.map((a, i) => (
                <text key={a.id} fg={focused && i === aSel ? theme.accent : theme.fg} truncate wrapMode="none">
                  {focused && i === aSel ? "› " : "  "}
                  <span fg={held[a.id] ? theme.ok : theme.dim}>{held[a.id] ? "⇩" : "○"} </span>
                  {a.name}
                  <span fg={theme.dim}>
                    {" "}· {a.transcript ? `${a.transcript.from}'s ${a.transcript.ai} conversation · ${a.transcript.entries} entries` : `${a.mime} · ${Math.max(1, Math.round(a.bytes / 1024))} kB`}
                    {a.note ? ` · "${a.note}"` : ""} · {nameFor(a.holder)} {age(a.attachedAt, now)} ago ·{" "}
                  </span>
                  {held[a.id] ? (
                    <span fg={theme.ok}>{a.transcript ? "here · enter reads it" : `here · ${held[a.id]}`}</span>
                  ) : online(a.holder) ? (
                    <span fg={theme.warn}>y fetch</span>
                  ) : (
                    <span fg={theme.dim}>{nameFor(a.holder)} is offline — fetch when they are</span>
                  )}
                </text>
              ))}
            </>
          )}
        </Focusable>
      ) : null}

      {/* body: conversation — every message about this ticket, in full, in a
          viewport of fixed height: ↑↓ scroll by message, the newest followed
          until you scroll up. */}
      <Focusable
        id="ticket-conversation"
        hint="↑↓ scroll · esc back to the list"
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (key.name === "up" && mSel > 0) return setMsgSel(mSel - 1), true;
          if (key.name === "down") {
            if (mSel >= rows.length - 1) return false; // at the end: let ↓ move on to diagnostics
            return setMsgSel(mSel + 1 >= rows.length - 1 ? null : mSel + 1), true;
          }
          return false;
        }}
      >
        {(focused) => (
          <>
            <SectionTitle
              title="conversation"
              note={`${conversation.length}`}
              focused={focused}
            />
            <box ref={convRef} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
              {lines.length === 0 ? (
                <text fg={theme.dim} truncate wrapMode="none">
                  {"  "}nothing said yet
                </text>
              ) : (
                lines.slice(lineStart, lineStart + CONVERSATION_HEIGHT).map((l, i) => (
                  <text key={`${l.row}-${i}`} fg={l.kind === "head" ? (focused && l.row === mSel ? theme.accent : theme.fg) : theme.dim} truncate wrapMode="none">
                    {l.kind === "head" ? (focused && l.row === mSel ? "› " : "  ") : "      "}
                    {l.kind === "head" ? l.head : l.text}
                  </text>
                ))
              )}
            </box>
          </>
        )}
      </Focusable>

      {/* foot: diagnostics — one line, flush at the bottom, result beneath */}
      <Focusable
        id="ticket-diagnostics"
        hint="←→ pick · enter run · esc back to the list"
        flexDirection="column"
        flexShrink={0}
        marginTop={1}
        onKey={(key) => {
          if (key.name === "left" && dSel > 0) return setDiagSel(dSel - 1), true;
          if (key.name === "right" && dSel < available.length - 1) return setDiagSel(dSel + 1), true;
          if (isEnter(key)) {
            const x = available[dSel];
            if (x) {
              if (x.d.open) navigate(x.d.open(ctx, to.ticket(ticketId)));
              else run({ id: x.d.id, params: x.params, ctx });
            }
            return true;
          }
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none">
              <span fg={focused ? theme.accent : theme.dim}>diagnostics</span>
              {available.map(({ d }, i) => (
                <span key={d.id} fg={focused && i === dSel ? theme.accent : theme.dim}>
                  {"   "}
                  {focused && i === dSel ? "› " : "  "}
                  {d.title}
                </span>
              ))}
            </text>
            {/* one line, always there — a result must not push the page around */}
            <text fg={AsyncResult.isFailure(outcome) ? theme.warn : theme.dim} truncate wrapMode="none">
              {"  "}
              {AsyncResult.isWaiting(outcome)
                ? "running…"
                : AsyncResult.isSuccess(outcome)
                  ? outcome.value.split("\n")[0]
                  : AsyncResult.isFailure(outcome)
                    ? `failed: ${String(outcome.cause)}`
                    : " "}
            </text>
          </>
        )}
      </Focusable>
    </box>
  );
}
