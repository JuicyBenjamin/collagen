import { useEffect, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { excludedFromEpic, heldBy, ticketName, visibleTo, type Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { cells, clip, fitColumns } from "../../../../../lib/columns";
import { EPIC_MARK, GLYPH, KIND_GLYPH, LEGEND, STACK } from "../../../../../lib/glyphs";
import { epicProgress, marksLabel, progressShort, rowTitle, summarize, type TicketSummary } from "../../../../../lib/ticketSummary";
import { drawnOrder, epicBlocks, groupTickets, kindHeading, type EpicBlock, type Row } from "../../../../../lib/ticketGroups";
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
  // an epic shows its tickets until someone folds it, for this session
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  // the list's own width, once drawn: the columns are sized to it
  const [pane, setPane] = useState<number | undefined>(undefined);
  // the rows scroll inside the pane: the cursor's row is kept in view
  const scroller = useRef<ScrollBoxRenderable>(null);

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8));

  // every ticket the room has that is not over, grouped; the cursor walks
  // the rows in the order they are drawn, headers are not stops
  // a ticket waiting on another (after) is its author's alone until it opens
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const nameOf = (id: string): string | undefined => {
    const t = byId.get(id);
    return t ? ticketName(t) : undefined;
  };
  const rows = tickets
    .filter((t) => visibleTo(t, byId, me))
    .map((t) => ({ t, s: summarize(t, trace, me, heldBy(t, byId), byId) }))
    .filter((r) => r.s.state !== "closed");
  // open epics first, each holding its tickets; the rest by project and kind
  const { epics, rest } = epicBlocks(rows, byId);
  const groups = groupTickets(rest);
  const unfolded = new Set(epics.map((e) => e.epic.t.id).filter((id) => !folded.has(id)));
  const shown = drawnOrder(groups, epics, unfolded);
  const needsYou = rows.filter((r) => r.s.state === "needs-you").length;
  const projects = new Set(rows.filter((r) => r.t.kind !== "epic").map((r) => r.t.project));
  // one lead column for the whole list, as wide as its longest lead
  const width = leadWidth([
    ...epics.flatMap((e) => [
      // an epic's title starts a name's width before the rows' titles
      " ".repeat(Math.max(0, cells(rowTitle(e.epic.t)) + partsWidth(foldedParts(e, unfolded.has(e.epic.t.id))) + 3 * foldedParts(e, unfolded.has(e.epic.t.id)).length - KIND - NAME)),
      ...(unfolded.has(e.epic.t.id) ? e.rows.map((r) => leadOf(r.t, 0, projects.size > 1 ? r.t.project : undefined)) : []),
    ]),
    ...groups.flatMap((g) => g.kinds.flatMap((k) => k.rows.map((r) => leadOf(r.t, k.depth.get(r.t.id) ?? 0, undefined)))),
  ]);
  // and one info column, as wide as its widest info
  const infoWidth = Math.max(
    0,
    ...epics.flatMap((e) => [
      cells(progressShort(epicProgress(e.epic.t, byId))),
      ...(unfolded.has(e.epic.t.id) ? e.rows.map((r) => partsWidth(rowInfo(r.s, undefined, nameOf, excludedFromEpic(r.t)))) : []),
    ]),
    ...groups.flatMap((g) => g.kinds.flatMap((k) => k.rows.map((r) => partsWidth(rowInfo(r.s, k.parent.get(r.t.id), nameOf, undefined))))),
  );
  // both bounded by the pane, as it is drawn: the titles first, the info in
  // what is left (lib/columns), truncated inside it
  const indent = groups.length > 1 ? 4 : 2;
  const { lead: leadCol, info: infoCol } = fitColumns({ lead: width, info: infoWidth }, pane === undefined ? undefined : pane - (indent - 2 + HEAD + NAME) - GAP);
  const index = new Map(shown.map((r, i) => [r.t.id, i]));

  const last = Math.max(0, shown.length - 1);
  const sel = clamp(cursor, 0, last);
  const current = shown[sel];
  const currentId = current?.t.id;
  // kept in view as the cursor moves — and as the rows move under it (an
  // epic folded or unfolded, tickets arriving or leaving above, a resize):
  // those are seen once laid out, as the list's content or box changes size
  const want = useRef<{ readonly id: string; readonly first: boolean } | null>(null);
  want.current = currentId ? { id: rowId(currentId), first: sel === 0 } : null;
  const keep = () => {
    if (want.current && scroller.current) keepInView(scroller.current, want.current.id, want.current.first);
  };
  useEffect(keep, [currentId, sel]);
  useEffect(() => {
    const list = scroller.current;
    if (!list) return;
    // after the scrollbox's own handling (it re-measures its range there),
    // never instead of it
    const undo = [list.content, list.viewport].map((part) => {
      const before = part.onSizeChange;
      part.onSizeChange = function (this: typeof part) {
        before?.call(this);
        keep();
      };
      return () => {
        part.onSizeChange = before;
      };
    });
    return () => undo.forEach((f) => f());
  });

  return (
    <Focusable
      id="tickets"
      hint={`↑↓ select · enter open${current?.t.kind === "epic" ? ` · space ${unfolded.has(current.t.id) ? "fold" : "unfold"}` : ""}${current?.t.kind === "review" ? " · o review in browser" : ""} · ? what it all means · ${LEGEND}`}
      flexDirection="column"
      marginTop={1}
      flexShrink={1}
      minHeight={0}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key)) {
          if (current) navigate(to.ticket(current.t.id));
          return true;
        }
        // an epic folds and unfolds where it stands
        if (key.name === "space" && current?.t.kind === "epic") {
          const id = current.t.id;
          setFolded((u) => {
            const next = new Set(u);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
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
            <span fg={needsYou > 0 ? theme.warn : theme.dim}> ({rows.length + unknownTickets.length})</span>
          </text>
          {shown.length === 0 && unknownTickets.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none
            </text>
          ) : (
            <scrollbox
              ref={scroller}
              flexShrink={1}
              minHeight={0}
              scrollbarOptions={{ visible: false }}
              onSizeChange={function (this: { width: number }) {
                setPane(this.width);
              }}
            >
            {epics.map((e) => (
              <EpicView
                key={e.epic.t.id}
                block={e}
                open={unfolded.has(e.epic.t.id)}
                first={epics[0] === e}
                indent={indent}
                width={leadCol}
                infoWidth={infoCol}
                selectedId={focused ? current?.t.id : undefined}
                progress={progressShort(epicProgress(e.epic.t, byId))}
                nameFor={nameFor}
                projects={projects.size > 1}
                goalOf={nameOf}
              />
            ))}
            {groups.map((g) => (
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
                        indent={indent}
                        depth={k.depth.get(r.t.id) ?? 0}
                        under={k.parent.get(r.t.id)}
                        goalOf={nameOf}
                        width={leadCol}
                        infoWidth={infoCol}
                      />
                    ))}
                  </box>
                ))}
              </box>
            ))}
            </scrollbox>
          )}
          {unknownTickets.map((u) => (
            <text key={u.key} fg={theme.dim} truncate wrapMode="none">
              {"        "}
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

/** An open epic, set apart by space above and below: one purple row — the
 *  crown, its title, how far along its tickets are, and the ▸ when a ticket
 *  inside is yours now — and under it, in their own colours, the tickets
 *  that are in it, each with its project when the room has more than one.
 *  Folded (space), the row says how many are tucked away. */
function EpicView({
  block,
  open,
  first,
  selectedId,
  progress,
  nameFor,
  projects,
  goalOf,
  indent,
  width,
  infoWidth,
}: {
  block: EpicBlock<Row>;
  open: boolean;
  first: boolean;
  /** the columns before the cursor that every other row has, so the crown
   *  sits on the headings' column and the title on the names' */
  indent: number;
  selectedId: string | undefined;
  progress: string;
  nameFor: (key: string) => string;
  projects: boolean;
  goalOf: (ticketId: string) => string | undefined;
  /** the rows' lead width, so the epic's progress sits on their info column */
  width: number;
  infoWidth: number;
}) {
  const selected = selectedId === block.epic.t.id;
  return (
    <box flexDirection="column" flexShrink={0} marginTop={first ? 1 : 0} marginBottom={1}>
      <box id={rowId(block.epic.t.id)} flexDirection="row" flexShrink={0}>
        <text wrapMode="none" flexShrink={0}>
          {" ".repeat(Math.max(0, indent - 2))}
          <span fg={selected ? theme.accent : theme.epic}>{selected ? "› " : "  "}</span>
          <span fg={theme.epic}>{EPIC_MARK} </span>
        </text>
        {/* the title starts on the tree's column, before the glyphs and the
            names: its column is that much wider than the rows' titles */}
        <text fg={theme.epic} truncate wrapMode="none" flexBasis={width + KIND + NAME} flexShrink={1} minWidth={0}>
          {rowTitle(block.epic.t)}
          {foldedParts(block, open).map((part) => (
            <span key={part.text} fg={part.warn ? theme.warn : theme.dim}>
              {" · "}
              {part.text}
            </span>
          ))}
        </text>
        <Info parts={[{ text: progress }]} width={infoWidth} />
      </box>
      {open
        ? block.rows.map((r, i) => (
            <TicketRow
              key={r.t.id}
              ticket={r.t}
              summary={r.s}
              selected={selectedId === r.t.id}
              nameFor={nameFor}
              indent={indent}
              depth={0}
              under={undefined}
              goalOf={goalOf}
              project={projects ? r.t.project : undefined}
              excluded={excludedFromEpic(r.t)}
              branch={i === block.rows.length - 1 ? "last" : "mid"}
              width={width}
              infoWidth={infoWidth}
            />
          ))
        : null}
    </box>
  );
}

/** Before the name, on every row: the cursor, the ▸, the tree, the glyph —
 *  two columns each. */
const HEAD = 8;
/** The most a waiting row spends naming what it waits on. */
const AFTER_MAX = 24;

/** Between the title and the info column. */
const GAP = 2;

/** The name column: eight letters and a space. */
const NAME = 9;
/** Between the tree's column and the name: the kind's glyph and a space each side. */
const KIND = 4;

/** What a row says before its info column: the staircase, the project
 *  (inside an epic) and the title — the text the info column aligns after. */
const staircase = (depth: number): string => (depth > 0 ? `${"  ".repeat(Math.min(depth, 6) - 1)}${STACK.follows} ` : "");
const leadOf = (t: Ticket, depth: number, project: string | undefined): string => `${staircase(depth)}${project ? `${project} · ` : ""}${rowTitle(t)}`;

/** The columns a list's lead takes: the longest one shown (a title is 60 at
 *  most), so the info column sits just past it on every row. */
const leadWidth = (leads: ReadonlyArray<string>): number => Math.max(0, ...leads.map(cells));

/** What follows a row's title, in the info column. */
type Part = { readonly text: string; readonly warn?: boolean };
const partsWidth = (parts: ReadonlyArray<Part>): number => parts.reduce((n, p, i) => n + cells(p.text) + (i > 0 ? 3 : 0), 0);

/** A ticket's info: out of its epic's progress, what holds it, what was said on it. */
const rowInfo = (
  s: TicketSummary,
  under: string | undefined,
  goalOf: (ticketId: string) => string | undefined,
  excluded: boolean | undefined,
): ReadonlyArray<Part> => {
  // waiting on the row it is drawn under says so in one word; waiting on one
  // elsewhere (another group, or a second of two) names it
  const elsewhere = s.held.filter((id) => id !== under);
  const on = elsewhere.length > 0 ? clip(goalOf(elsewhere[0]!) ?? elsewhere[0]!.slice(0, 8), AFTER_MAX) : "";
  const people = marksLabel(s);
  return [
    ...(excluded ? [{ text: "excluded" }] : []),
    ...(s.held.length > 0 ? [{ text: `${on ? `${STACK.waits} after "${on}"` : `${STACK.waits} waiting`}${elsewhere.length > 1 ? ` +${elsewhere.length - 1}` : ""}` }] : []),
    ...(people.length > 0 ? [{ text: people, warn: s.state === "needs-you" }] : []),
  ];
};

/** Folded, an epic says after its title how many it holds and how many are
 *  yours — there is room beside a title, and its info column keeps the progress. */
const foldedParts = (block: EpicBlock<Row>, open: boolean): ReadonlyArray<Part> => {
  const yours = block.rows.filter((r) => r.s.state === "needs-you").length;
  return [
    ...(!open && block.rows.length > 0 ? [{ text: `${block.rows.length} folded` }] : []),
    ...(!open && yours > 0 ? [{ text: `${GLYPH.yours} ${yours} yours`, warn: true }] : []),
  ];
};

/** The info column: two past the longest title on screen, and as wide as
 *  the widest info — so when the list is narrower than both, every title
 *  gives up the same columns and the info still starts on one line. (A
 *  title's column is a flexBasis, not a width: OpenTUI turns flexShrink off
 *  when a numeric width is set after mount, and the title would stop giving
 *  way the first time the column changed — on a fold, say.) */
function Info({ parts, width }: { parts: ReadonlyArray<Part>; width: number }) {
  if (width === 0) return null;
  // cut at the end, where the reader stops, not in the middle: what comes
  // first (the kind of hold, the first mark) is what has to show
  const fitted: Array<Part> = [];
  let left = width;
  for (const part of parts) {
    const text = `${fitted.length > 0 ? " · " : ""}${part.text}`;
    if (left <= 0) break;
    fitted.push({ ...part, text: clip(text, left) });
    left -= cells(text);
  }
  return (
    <text wrapMode="none" flexBasis={width} flexShrink={0} marginLeft={GAP}>
      {fitted.map((part, i) => (
        <span key={i} fg={part.warn ? theme.warn : theme.dim}>
          {part.text}
        </span>
      ))}
    </text>
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
/** the id a ticket's row is drawn under, so the list can scroll to it */
const rowId = (ticketId: string): string => `row-${ticketId}`;

/** Scroll the list only as far as the cursor's row needs: not at all while
 *  it is in view, and when it would leave, by exactly enough to bring it to
 *  the edge it left by — so the list moves with the cursor, one row at a
 *  time, and never jumps. At the first row, all the way up, so what heads
 *  the list shows. The row's place is measured inside the list's content,
 *  which does not move as it scrolls (OpenTUI's own scrollChildIntoView
 *  measured it on screen, against a viewport that had, and drifted). */
const keepInView = (list: ScrollBoxRenderable, id: string, first: boolean): void => {
  if (first) {
    list.scrollTop = 0;
    return;
  }
  const row = list.content.findDescendantById(id);
  if (!row) return;
  const at = row.y - list.content.y;
  const height = list.viewport.height;
  if (at < list.scrollTop) list.scrollTop = at;
  else if (at + row.height > list.scrollTop + height) list.scrollTop = at + row.height - height;
};

function TicketRow({
  ticket: t,
  summary: s,
  selected,
  nameFor,
  indent,
  depth,
  under,
  goalOf,
  project,
  excluded,
  branch,
  width,
  infoWidth,
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
  /** its project, said before its goal — inside an epic, which spans them */
  project?: string;
  /** in its epic but out of its progress */
  excluded?: boolean;
  /** inside an epic: its line of the tree, under the epic's title */
  branch?: "mid" | "last";
  /** the lead column's width: the info after it starts on the same column on every row */
  width: number;
  /** the info column's width, the widest info on screen */
  infoWidth: number;
}) {
  const yours = s.state === "needs-you";
  // waiting on another ticket: only its author sees the row, dim, saying on what
  const dim = s.state === "done" || s.held.length > 0 || excluded === true;
  const fg = selected ? theme.accent : dim ? theme.dim : theme.fg;
  return (
    <box id={rowId(t.id)} flexDirection="row" flexShrink={0}>
      <text fg={fg} wrapMode="none" flexShrink={0}>
        {" ".repeat(Math.max(0, indent - 2))}
        {selected ? "› " : "  "}
        {/* the row's own mark: it is yours to act on. Carried here and not only
            in the people's colour, because on your own ticket the people list can
            be empty — and then a change request had no trace on screen at all.
            Same column on every row, an epic's tickets too */}
        <span fg={theme.warn}>{yours ? `${GLYPH.yours} ` : "  "}</span>
        {/* inside an epic, its line of the tree, dropping from the first
            letter of the epic's title; a blank of that width on every other
            row, so the glyphs and the names keep one column throughout */}
        {branch ? <span fg={theme.epic}>{branch === "last" ? "└ " : "├ "}</span> : "  "}
        {/* every row's kind, as a glyph: under a heading it learns what it
            means, and inside an epic — no headings there — it says it */}
        <span fg={theme.dim}>{t.kind === "epic" ? "  " : `${KIND_GLYPH[t.kind]} `}</span>
        <span fg={s.mine ? theme.accent : theme.dim}>{nameFor(t.createdBy).slice(0, NAME - 1).padEnd(NAME)}</span>
      </text>
      <text fg={fg} truncate wrapMode="none" flexBasis={width} flexShrink={1} minWidth={0}>
        {/* a staircase: two columns a level, capped so a long chain keeps its goals readable */}
        {depth > 0 ? <span fg={theme.dim}>{staircase(depth)}</span> : null}
        {project ? <span fg={theme.dim}>{project} · </span> : null}
        {t.title ? t.title : <span fg={theme.dim}>{rowTitle(t)}</span>}
      </text>
      <Info parts={rowInfo(s, under, goalOf, excluded)} width={infoWidth} />
    </box>
  );
}
