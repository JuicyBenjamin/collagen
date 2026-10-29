import { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { heldBy, KINDS, ticketName, visibleTo, type Ticket } from "@collagen/p2p";
import { diagnostics } from "../../../diagnostics";
import { GLYPH } from "../../../lib/glyphs";
import { aboutTicket, age, marksLabel, rowTitle, STATE_LABEL, summarize, ticketThreads } from "../../../lib/ticketSummary";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { to, useRouter, type TicketRoute } from "../../../app/router";
import { roomAtom } from "../../atoms";
import { attachmentsAtom, fetchAttachmentAtom, heldAttachmentsAtom, identityAtom, membersAtom, outboxAtom, reviewsAtom, rosterAtom, traceAtom } from "../atoms";
import { reviewHeadline } from "../../../lib/review";
import { Arrow } from "../components/Arrow/Arrow";
import { wrap } from "../../../lib/wrap";
import { ticketsAtom } from "../overview/components/Tickets/atoms";
import { runDiagnosticAtom, takeStepAtom } from "./atoms";
import { openReviewPageAtom } from "../review/atoms";
import { EpicPage } from "./EpicPage";
import { via } from "../../../lib/agents";

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
  retired: "—",
};

/** One ticket, as a page.
 *    header  — the meta: goal, state, project, who made it, who is in it
 *    body    — steps; attachments (files on the ticket, if any); conversation
 *    foot    — diagnostics, one row, tucked away
 *  The overview is the list; this is the show. `esc` goes back. */
/** The sections of a ticket's page: where the cursor may already be when it opens. */
const PAGE_SECTIONS: ReadonlyArray<string> = ["ticket-review", "ticket-steps", "ticket-attachments", "ticket-conversation", "ticket-diagnostics"];

/** `route` is how this page was reached: the pages it opens come back to it, and from it to where it came from. */
export function TicketPage({ ticketId, route }: { ticketId: string; route: TicketRoute }) {
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
    const height = convRef.current?.height;
    if (height && height > 0 && height !== convHeight) setConvHeight(height);
  });
  const run = useAtomSet(runDiagnosticAtom);
  const openPage = useAtomSet(openReviewPageAtom);
  const outcome = useAtomValue(runDiagnosticAtom);
  const take = useAtomSet(takeStepAtom);
  const taking = useAtomValue(takeStepAtom);
  const [stepSel, setStepSel] = useState(0);
  const [msgSel, setMsgSel] = useState<number | null>(null);
  const [diagSel, setDiagSel] = useState(0);
  const [attSel, setAttSel] = useState(0);

  // the cursor lands on the steps when a ticket opens — unless we came back
  // from a page of ours (transcripts), which put it on one of these. Each
  // ticket, not each mount: from an epic's page to a ticket in it is the same
  // page with another ticket, and the cursor must not stay on the epic's list
  // — no section would hold it, and ← (back) would do nothing
  // (an epic's page places its own cursor, on its list)
  const isEpic = tickets.find((candidate) => candidate.id === ticketId)?.kind === "epic";
  useEffect(() => {
    if (!isEpic && !PAGE_SECTIONS.includes(focus)) setFocus("ticket-steps");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on each ticket opened
  }, [setFocus, ticketId, isEpic]);

  const ticket = tickets.find((candidate) => candidate.id === ticketId);
  // a ticket still waiting on another is its author's alone — not opened by anyone else, however they got here
  const gated = ticket !== undefined && !visibleTo(ticket, new Map(tickets.map((candidate) => [candidate.id, candidate])), identity?.pubkey ?? "");
  if (!ticket || gated) {
    return (
      <text fg={theme.dim} marginTop={1}>
        ticket {ticketId.slice(0, 8)} is {gated ? "not shown to you yet" : "not in this room"} — esc goes back
      </text>
    );
  }

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8));
  const review = reviews.find((existing) => existing.ticketId === ticket.id);
  // an epic is a folder: a page of its own, its tickets rather than steps
  if (ticket.kind === "epic") {
    const all = new Map(tickets.map((candidate) => [candidate.id, candidate]));
    return <EpicPage epic={ticket} all={all} why={review} summaries={(candidate) => summarize(candidate, trace, me, heldBy(candidate, all, me), all)} nameFor={nameFor} me={me} />;
  }
  const threads = ticketThreads(ticket);
  const conversation = trace.filter((message) => aboutTicket(ticket, threads, message));
  const byId = new Map(tickets.map((candidate) => [candidate.id, candidate]));
  const waitsOn = heldBy(ticket, byId, me);
  const summary = summarize(ticket, trace, me, waitsOn);
  const now = Date.now();
  const rows = conversation.map((message) => ({ kind: "msg" as const, id: message.id, m: message }));
  // files attached to this ticket: references from the log; the file is here
  // once fetched (or when we attached it)
  const attachments = allAttachments.filter((attachment) => attachment.ticketId === ticket.id);
  const online = (key: string) => key === me || peers.some((peer) => peer.key === key);
  const aSel = clamp(attSel, 0, Math.max(0, attachments.length - 1));
  const fetchNote = AsyncResult.isSuccess(fetchOutcome) ? fetchOutcome.value : AsyncResult.isFailure(fetchOutcome) ? `failed: ${String(fetchOutcome.cause)}` : "";
  // every row in full: a head line (who → whom · intent) then its text, wrapped
  const textWidth = Math.max(30, width - 30);
  const lines = rows.flatMap((entry, row) => {
    const head = (
      <>
        <Arrow from={`${nameFor(entry.m.from)}${via(entry.m.agent)}`} to={nameFor(entry.m.to)} mine={entry.m.from === me} />
        <span fg={theme.dim}> · {entry.m.intent}</span>
      </>
    );
    const text = entry.m.findings;
    return [{ kind: "head" as const, row, head, text: "" }, ...wrap(text, textWidth).map((line) => ({ kind: "body" as const, row, head: null, text: line }))];
  });
  const firstLineOf = (row: number) => lines.findIndex((line) => line.row === row);
  const context = { roomId, ticketId };
  const available = diagnostics.flatMap((diagnostic) => {
    const params = diagnostic.fromContext(context);
    return params === null ? [] : [{ diagnostic, params }];
  });
  const done = ticket.steps.filter((step) => step.status === "settled").length;
  // what has been said on it, not by whom — the steps below say who
  const people = marksLabel(summary);
  // a ticket every step of which is answered is done — unless the answer was a
  // request for changes: the same ↻ the list shows, never a check
  const glyph = summary.changesAsked && summary.state !== "closed" ? GLYPH.changes : summary.state === "done" ? "✓" : summary.state === "failed" ? "✗" : "⧉";
  const glyphColor = summary.changesAsked ? (summary.state === "needs-you" ? theme.warn : theme.dim) : summary.state === "done" ? theme.ok : theme.warn;
  const stateText = summary.state === "waiting" ? `waiting on ${[...summary.waitingOn.map(nameFor), ...(summary.open > 0 ? ["anyone"] : [])].join(", ")}` : STATE_LABEL[summary.state];
  const sSel = clamp(stepSel, 0, Math.max(0, ticket.steps.length - 1));
  // a step nobody has is anyone's to take
  const selected = ticket.steps[sSel];
  const open = selected !== undefined && selected.owner === undefined && selected.status === "pending" && !ticket.closed;
  // a refusal is said here; a take shows on the step itself
  const takeNote = AsyncResult.isSuccess(taking) && taking.value.startsWith("failed") ? (taking.value.split("\n")[0] ?? "") : "";
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
        <span fg={ticket.title ? theme.fg : theme.dim}>{rowTitle(ticket)}</span>
        <span fg={summary.state === "needs-you" ? theme.warn : theme.dim}>
          {"   "}{stateText}
        </span>
        <span fg={theme.dim}> · {age(summary.lastActivity, now)}</span>
      </text>
      {/* beneath the title, what the ticket is about, in full */}
      <text fg={theme.fg} wrapMode="word" flexShrink={0}>
        {"  "}
        {ticket.goal}
      </text>
      <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
        {"  "}
        {ticket.project} · by {nameFor(ticket.createdBy)}{via(ticket.agent)} · {done}/{ticket.steps.length} settled
        {people.length > 0 ? ` · ${people}` : ""}
      </text>
      {/* what kind of thing this is, in the app's own words (p2p KINDS — the
          same line the ? panel and the tickets guide carry): "plan" alone
          does not say "do you agree" */}
      <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
        {"  "}
        <span fg={theme.fg}>{ticket.kind}</span> — {KINDS[ticket.kind].what} · asks: {KINDS[ticket.kind].asks}
      </text>
      {/* the order it keeps: read after these — and, while one is unanswered,
          shown to nobody but its author */}
      {ticket.after && ticket.after.length > 0 ? (
        <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
          {"  "}after {ticket.after.map((id) => `"${byId.get(id) ? ticketName(byId.get(id)!) : id.slice(0, 8)}"`).join(", ")}
          {waitsOn.length > 0 ? <span fg={theme.warn}> · waiting: nobody else is shown it until {waitsOn.length === 1 ? "that is" : "those are"} answered</span> : null}
        </text>
      ) : null}

      {/* body: why — a review ticket carries the reasons behind the change.
          The headline here, the whole of it one enter away. */}
      {review ? (
        <Focusable
          id="ticket-review"
          hint="enter reads the why — every decision, how it was steered, and the forks · o the diff by decision, in your browser · esc back to the list"
          flexDirection="column"
          flexShrink={0}
          onKey={(key) => {
            if (isEnter(key)) return navigate(to.review(ticketId, route)), true;
            // the code itself, grouped under the why — a page of its own, in the browser
            if (key.name === "o") return openPage({ ticketId }), true;
            return false;
          }}
        >
          {(focused) => (
            <>
              <SectionTitle title="why" note={`${reviewHeadline(review, { link: false })} · updated ${age(review.ts, now)}`} focused={focused} />
              <text fg={theme.dim} wrapMode="word">
                {"  "}
                {review.summary}
              </text>
              <text fg={focused ? theme.accent : theme.dim} truncate wrapMode="none">
                {"  "}enter reads it · o shows the diff by decision · by {nameFor(review.author)}{via(review.agent)}
              </text>
            </>
          )}
        </Focusable>
      ) : null}

      {/* body: steps */}
      <box flexShrink={0}>
        <Focusable
          id="ticket-steps"
          hint={`↑↓ select step${open ? " · t take it" : ""} · ↓ past the last goes to the conversation · esc back to the list`}
          flexDirection="column"
          flexGrow={1}
          flexShrink={0}
          onKey={(key) => {
            if (key.name === "up" && sSel > 0) return setStepSel(sSel - 1), true;
            if (key.name === "down" && sSel < ticket.steps.length - 1) return setStepSel(sSel + 1), true;
            if (key.name === "t" && open) return take({ roomId, ticketId: ticket.id, stepId: selected.id, title: rowTitle(ticket) }), true;
            return false;
          }}
        >
          {(focused) => (
            <>
              <SectionTitle title="steps" note={`${done}/${ticket.steps.length} settled${takeNote ? ` · ${takeNote}` : ""}`} focused={focused} />
              {ticket.steps.map((step, index) => (
                <box key={step.id} flexDirection="column">
                  <text fg={focused && index === sSel ? theme.accent : theme.fg} truncate wrapMode="none">
                    {focused && index === sSel ? "› " : "  "}
                    <span fg={step.status === "settled" ? theme.ok : step.status === "failed" ? theme.warn : theme.dim}>{STEP_GLYPH[step.status]}</span> {step.id}{" "}
                    {step.owner === undefined ? <span fg={theme.warn}>anyone</span> : nameFor(step.owner)}
                    {step.agent ? <span fg={theme.dim}>{via(step.agent)}</span> : null} · {step.intent}
                    {step.needs.length > 0 ? <span fg={theme.dim}> · needs {step.needs.join("+")}</span> : null}
                  </text>
                  <text fg={theme.dim} wrapMode="word">
                    {"      "}
                    {step.result ?? step.description}
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
            const attachment = attachments[aSel];
            if (!attachment) return false;
            if (key.name === "y" && !held[attachment.id]) return fetch({ roomId, attachmentId: attachment.id }), true;
            if (isEnter(key)) {
              const file = held[attachment.id];
              if (file && attachment.transcript) navigate(to.transcript(file, attachment.name, route));
              else if (!file) fetch({ roomId, attachmentId: attachment.id });
              return true;
            }
            return false;
          }}
        >
          {(focused) => (
            <>
              <SectionTitle title="attachments" note={`${attachments.length} file${attachments.length === 1 ? "" : "s"}${fetchNote ? ` · ${fetchNote}` : ""}`} focused={focused} />
              {attachments.map((attachment, index) => (
                <text key={attachment.id} fg={focused && index === aSel ? theme.accent : theme.fg} truncate wrapMode="none">
                  {focused && index === aSel ? "› " : "  "}
                  <span fg={held[attachment.id] ? theme.ok : theme.dim}>{held[attachment.id] ? "⇩" : "○"} </span>
                  {attachment.name}
                  <span fg={theme.dim}>
                    {" "}· {attachment.transcript ? `${attachment.transcript.from}'s ${attachment.transcript.ai} conversation · ${attachment.transcript.entries} entries` : `${attachment.mime} · ${Math.max(1, Math.round(attachment.bytes / 1024))} kB`}
                    {attachment.note ? ` · "${attachment.note}"` : ""} · {nameFor(attachment.holder)} {age(attachment.attachedAt, now)} ago ·{" "}
                  </span>
                  {held[attachment.id] ? (
                    <span fg={theme.ok}>{attachment.transcript ? "here · enter reads it" : `here · ${held[attachment.id]}`}</span>
                  ) : online(attachment.holder) ? (
                    <span fg={theme.warn}>y fetch</span>
                  ) : (
                    <span fg={theme.dim}>{nameFor(attachment.holder)} is offline — fetch when they are</span>
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
                lines.slice(lineStart, lineStart + CONVERSATION_HEIGHT).map((line, index) => (
                  <text key={`${line.row}-${index}`} fg={line.kind === "head" ? (focused && line.row === mSel ? theme.accent : theme.fg) : theme.dim} truncate wrapMode="none">
                    {line.kind === "head" ? (focused && line.row === mSel ? "› " : "  ") : "      "}
                    {line.kind === "head" ? line.head : line.text}
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
            const entry = available[dSel];
            if (entry) {
              if (entry.diagnostic.open) navigate(entry.diagnostic.open(context, route));
              else run({ id: entry.diagnostic.id, params: entry.params, context });
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
              {available.map(({ diagnostic }, index) => (
                <span key={diagnostic.id} fg={focused && index === dSel ? theme.accent : theme.dim}>
                  {"   "}
                  {focused && index === dSel ? "› " : "  "}
                  {diagnostic.title}
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
