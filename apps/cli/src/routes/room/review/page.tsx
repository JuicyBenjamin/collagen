import { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ReviewContext } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { theme } from "../../../app/theme";
import { clamp } from "../../../lib/math";
import { wrap } from "../../../lib/wrap";
import { identityAtom, membersAtom, reviewsAtom, rosterAtom } from "../atoms";
import { ticketsAtom } from "../overview/components/Tickets/atoms";

interface Line {
  readonly text: string;
  readonly color: string;
}

/** The why, as lines: the change in the author's words, then every decision
 *  with how their person steered it and what their agent reasoned, then every
 *  fork in the road with the file:line it produced. */
const linesOf = (r: ReviewContext, by: string, width: number): ReadonlyArray<Line> => {
  const out: Line[] = [];
  const para = (text: string, color: string, indent: string) => {
    for (const line of wrap(text, Math.max(20, width - indent.length))) out.push({ text: `${indent}${line}`, color });
  };
  const where = r.branch ? (r.base ? `${r.branch} → ${r.base}` : r.branch) : "";
  if (where.length > 0) out.push({ text: `  ${where}`, color: theme.fg });
  if (r.link) out.push({ text: `  ${r.link}`, color: theme.accent });
  out.push({ text: `  by ${by} · last revised ${new Date(r.ts).toISOString().slice(0, 16).replace("T", " ")}`, color: theme.dim });
  out.push({ text: "", color: theme.dim });
  para(r.summary, theme.fg, "  ");

  out.push({ text: "", color: theme.dim });
  out.push({ text: `  decisions · ${r.decisions.length}`, color: theme.fg });
  if (r.decisions.length === 0) out.push({ text: "    none recorded", color: theme.dim });
  for (const d of r.decisions) {
    out.push({ text: "", color: theme.dim });
    para(`${d.id} ${d.what}`, theme.fg, "  ");
    if (d.userWhy) para(`the user: ${d.userWhy}`, theme.accent, "      ");
    if (d.agentWhy) para(`the agent: ${d.agentWhy}`, theme.dim, "      ");
    if (d.where.length > 0) out.push({ text: `      ${d.where.join("  ")}`, color: theme.ok });
  }

  out.push({ text: "", color: theme.dim });
  out.push({ text: `  forks in the road · ${r.forks.length}`, color: theme.fg });
  if (r.forks.length === 0) out.push({ text: "    none — the work had no real alternatives", color: theme.dim });
  for (const f of r.forks) {
    out.push({ text: "", color: theme.dim });
    out.push({ text: `  ${f.id} ${f.at}`, color: theme.ok });
    para(`chose ${f.chose}`, theme.fg, "      ");
    para(`instead of ${f.instead}`, theme.dim, "      ");
    para(`${f.why}${f.by ? ` · ${f.by === "user" ? "the user's" : "the agent's"} call` : ""}`, theme.warn, "      ");
  }
  return out;
};

/** The why behind a review ticket, in full: read it, then say what you think
 *  of the reasons — not only of the code. Scrolls; ← / esc go back. */
export function ReviewPage({ ticketId }: { ticketId: string }) {
  const { width } = useTerminalDimensions();
  const setFocus = useAtomSet(focusAtom);
  const reviews = AsyncResult.getOrElse(useAtomValue(reviewsAtom), () => [] as const);
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const [top, setTop] = useState(0);
  const listRef = useRef<BoxRenderable>(null);
  const [viewport, setViewport] = useState(8);
  useEffect(() => {
    const h = listRef.current?.height;
    if (h && h > 0 && h !== viewport) setViewport(h);
  });
  useEffect(() => {
    setFocus("ticket-review");
    setTop(0);
  }, [setFocus, ticketId]);

  const review = reviews.find((r) => r.ticketId === ticketId);
  const ticket = tickets.find((t) => t.id === ticketId);
  const nameFor = (key: string): string =>
    key === (identity?.pubkey ?? "") ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));

  if (!review) {
    return (
      <text fg={theme.dim} marginTop={1}>
        {ticket ? `"${ticket.goal}" is not a review ticket — no why came with it` : `ticket ${ticketId.slice(0, 8)} is not in this room`} — esc goes back
      </text>
    );
  }

  const lines = linesOf(review, nameFor(review.author), Math.max(30, width - 12));
  const maxTop = Math.max(0, lines.length - viewport);
  const at = clamp(top, 0, maxTop);
  const scroll = (by: number) => setTop(clamp(at + by, 0, maxTop));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="ticket-review"
        hint="↑↓ scroll · pgup/pgdn screen · home/end · ← / esc back to the ticket"
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (key.name === "up") return scroll(-1), true;
          if (key.name === "down") return scroll(1), true;
          if (key.name === "pageup") return scroll(-viewport), true;
          if (key.name === "pagedown") return scroll(viewport), true;
          if (key.name === "home") return setTop(0), true;
          if (key.name === "end") return setTop(maxTop), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>why</span>
              <span fg={theme.dim}>
                {" "}· {review.decisions.length} decision{review.decisions.length === 1 ? "" : "s"} · {review.forks.length} fork
                {review.forks.length === 1 ? "" : "s"}
                {at < maxTop ? ` · ${maxTop - at} more line(s) below` : ""}
              </span>
            </text>
            <box ref={listRef} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
              {lines.slice(at, at + viewport).map((l, i) => (
                <text key={`${ticketId}:${at + i}`} fg={l.color} truncate wrapMode="none" flexShrink={0}>
                  {l.text.length === 0 ? " " : l.text}
                </text>
              ))}
            </box>
          </>
        )}
      </Focusable>
    </box>
  );
}
