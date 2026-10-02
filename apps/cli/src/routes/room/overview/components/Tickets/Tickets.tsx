import { useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { heldBy, visibleTo, type Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { GLYPH, LEGEND, STACK } from "../../../../../lib/glyphs";
import { marksLabel, summarize, type TicketSummary } from "../../../../../lib/ticketSummary";
import { drawnOrder, groupTickets, kindHeading } from "../../../../../lib/ticketGroups";
import { identityAtom, membersAtom, rosterAtom, traceAtom, unseenAtom } from "../../../atoms";
import { ticketsAtom } from "./atoms";
import { openReviewPageAtom } from "../../../review/atoms";

/** Shared tickets — every ticket the room has that its author has not
 *  closed, whoever made it and whoever it is for. Grouped by project (a
 *  header per project, left out when the room has one), then by kind in the
 *  order work moves through them — proposals, plans, bugs, reviews, tasks
 *  (lib/ticketGroups) — so a project reads as its pipeline. Inside a group,
 *  ordered by what wants a person: needs-you, then waiting, then failed,
 *  then finished-but-open (dim: every step answered, its author has not
 *  said it is over). A CLOSED ticket
 *  — the author's recorded decision, close-ticket — leaves this list and
 *  stays on the log with its steps as they were, where agents still read it
 *  and later tickets refer back to it. Nothing is deleted. ↑↓ select, enter
 *  opens the ticket's page. The `›` is the cursor, nothing else. */
export function Tickets() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  // what a newer collagen wrote here that this build cannot read: a ticket
  // among them gets a row of its own, the rest a count — both say to update
  const unseen = AsyncResult.getOrElse(useAtomValue(unseenAtom), () => [] as const);
  const unknownTickets = unseen.filter((u) => u.key.startsWith("ticket/"));
  const unseenOther = unseen.length - unknownTickets.length;
  const { navigate } = useRouter();
  const openReviewPage = useAtomSet(openReviewPageAtom);
  const [cursor, setCursor] = useState(0);

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));

  // every ticket the room has that is not over, grouped; the cursor walks
  // the rows in the order they are drawn, headers are not stops
  // a ticket waiting on another (after) is its author's alone until it opens
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const groups = groupTickets(
    tickets
      .filter((t) => visibleTo(t, byId, me))
      .map((t) => ({ t, s: summarize(t, trace, me, heldBy(t, byId)) }))
      .filter((r) => r.s.state !== "closed"),
  );
  const shown = drawnOrder(groups);
  const needsYou = shown.filter((r) => r.s.state === "needs-you").length;
  const index = new Map(shown.map((r, i) => [r.t.id, i]));

  const last = Math.max(0, shown.length - 1);
  const sel = clamp(cursor, 0, last);
  const current = shown[sel];

  return (
    <Focusable
      id="tickets"
      hint={`↑↓ select · enter open${current?.t.kind === "review" ? " · o review in browser" : ""} · ? what it all means · ${LEGEND}`}
      flexDirection="column"
      marginTop={1}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key)) {
          if (current) navigate(to.ticket(current.t.id));
          return true;
        }
        // straight from the list to the diff read by intent, in the browser
        if (key.name === "o" && current?.t.kind === "review") return openReviewPage({ ticketId: current.t.id }), true;
        return false;
      }}
    >
      {(focused) => (
        <>
          <text truncate wrapMode="none" flexShrink={0}>
            <span fg={focused ? theme.accent : theme.dim}>tickets</span>
            <span fg={needsYou > 0 ? theme.warn : theme.dim}> ({shown.length + unknownTickets.length})</span>
          </text>
          {shown.length === 0 && unknownTickets.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none
            </text>
          ) : (
            groups.map((g) => (
              <box key={g.project} flexDirection="column" flexShrink={0}>
                {groups.length > 1 ? (
                  <text fg={theme.fg} truncate wrapMode="none">
                    {"  "}
                    {g.project}
                  </text>
                ) : null}
                {g.kinds.map((k) => (
                  <box key={k.kind} flexDirection="column" flexShrink={0}>
                    <text fg={theme.dim} truncate wrapMode="none">
                      {groups.length > 1 ? "    " : "  "}
                      {kindHeading(k.kind)}
                    </text>
                    {k.rows.map((r) => (
                      <TicketRow
                        key={r.t.id}
                        ticket={r.t}
                        summary={r.s}
                        selected={focused && index.get(r.t.id) === sel}
                        nameFor={nameFor}
                        indent={groups.length > 1 ? 4 : 2}
                        depth={k.depth.get(r.t.id) ?? 0}
                        under={k.parent.get(r.t.id)}
                        goalOf={(id) => byId.get(id)?.goal}
                      />
                    ))}
                  </box>
                ))}
              </box>
            ))
          )}
          {unknownTickets.map((u) => (
            <text key={u.key} fg={theme.dim} truncate wrapMode="none">
              {"    "}
              {"unknown".padEnd(9)}update collagen to see this ticket
            </text>
          ))}
          {unseenOther > 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}
              {unseenOther} more record{unseenOther === 1 ? "" : "s"} here need{unseenOther === 1 ? "s" : ""} a newer collagen
            </text>
          ) : null}
        </>
      )}
    </Focusable>
  );
}

/** One ticket at a glance: whose it is, what it is about, and what has been
 *  said on it — `↻` changes were asked for, `✓` someone approved, one glyph
 *  per kind of answer however many gave it (lib/glyphs, spelled out on `?`).
 *  Not who said it: that is the ticket page's job. Its kind is the header
 *  it sits under.
 *
 *  The first column is whose it is — "you" bright when this person started
 *  the ticket, the author's name dim when somebody else did — and it keeps
 *  that colour under the cursor: "mine or theirs" is the first thing the eye
 *  asks of a list, and the answer should not move when the selection does.
 *  (It held the kind until the kinds became headers.) Nothing else: the
 *  ticket's own page has the rest, and an agent can read all of it. */
function TicketRow({
  ticket: t,
  summary: s,
  selected,
  nameFor,
  indent,
  depth,
  under,
  goalOf,
}: {
  ticket: Ticket;
  summary: TicketSummary;
  selected: boolean;
  nameFor: (key: string) => string;
  /** columns before the cursor, so a row sits under its header */
  indent: number;
  /** levels under the ticket it is read after, in its group (0: none) */
  depth: number;
  /** the ticket it is drawn under, when it is */
  under: string | undefined;
  goalOf: (ticketId: string) => string | undefined;
}) {
  const people = marksLabel(s);
  const yours = s.state === "needs-you";
  // waiting on another ticket: only its author sees the row, dim, saying on what
  const waits = s.held.length > 0;
  const dim = s.state === "done" || waits;
  // waiting on the row it is drawn under says so in one word; waiting on one
  // elsewhere (another group, or a second of two) names it
  const elsewhere = s.held.filter((id) => id !== under);
  const on = elsewhere.length > 0 ? (goalOf(elsewhere[0]!) ?? elsewhere[0]!.slice(0, 8)) : "";
  return (
    <text fg={selected ? theme.accent : dim ? theme.dim : theme.fg} truncate wrapMode="none">
      {" ".repeat(Math.max(0, indent - 2))}
      {selected ? "› " : "  "}
      {/* the row's own mark: it is yours to act on. Carried here and not only
          in the people's colour, because on your own ticket the people list can
          be empty — and then a change request had no trace on screen at all */}
      <span fg={theme.warn}>{yours ? `${GLYPH.yours} ` : "  "}</span>
      <span fg={s.mine ? theme.accent : theme.dim}>{nameFor(t.createdBy).slice(0, 8).padEnd(9)}</span>
      {/* a staircase: two columns a level, capped so a long chain keeps its goals readable */}
      {depth > 0 ? <span fg={theme.dim}>{`${"  ".repeat(Math.min(depth, 6) - 1)}${STACK.follows} `}</span> : null}
      {t.goal}
      {waits ? (
        <span fg={theme.dim}>
          {on ? ` · ${STACK.waits} after "${on}"` : ` · ${STACK.waits} waiting`}
          {elsewhere.length > 1 ? ` +${elsewhere.length - 1}` : ""}
        </span>
      ) : null}
      {people.length > 0 ? (
        <>
          <span fg={theme.dim}> · </span>
          <span fg={s.state === "needs-you" ? theme.warn : theme.dim}>{people}</span>
        </>
      ) : null}
    </text>
  );
}
