import { useState, type ReactNode } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { BOARD_LABEL, closedAs } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { FollowScroll } from "../../../components/FollowScroll";
import { isEnter, isSpace } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { to, useRouter } from "../../../app/router";
import { clamp } from "../../../lib/math";
import { cells, clip } from "../../../lib/columns";
import { GLYPH } from "../../../lib/glyphs";
import { BOARD_KINDS, boardEpics, boardOf, kindCounts, unreadLine, unreadTickets, type BoardKind, type Lane } from "../../../lib/board";
import { kindGlyph } from "../../../lib/ticketTabs";
import { rowTitle } from "../../../lib/ticketSummary";
import type { Row } from "../../../lib/ticketGroups";
import { roomAtom } from "../../atoms";
import { identityAtom, membersAtom, rosterAtom, traceAtom, unseenAtom } from "../atoms";
import { ticketsAtom } from "../overview/components/Tickets/atoms";
import { openReviewPageAtom } from "../review/atoms";
import { boardCursorAtom, boardEpicAtom, boardKindsAtom, openBoardPageAtom } from "./atoms";

/** The board: the room's tickets in three columns — to do, in progress,
 *  done — by p2p's boardColumn, the rule the app's board reads too. Only
 *  what this reader may be shown (lib/board). ←→ move between columns, ↑↓
 *  within one, enter opens the ticket's page (esc comes back here). The
 *  cursor stays on the ticket it is on: when that ticket moves column, the
 *  cursor goes with it. */
export function BoardPage() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  const unread = unreadTickets(AsyncResult.getOrElse(useAtomValue(unseenAtom), () => [] as const));
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const openReviewPage = useAtomSet(openReviewPageAtom);
  const openBoardPage = useAtomSet(openBoardPageAtom);
  const { navigate } = useRouter();
  const chosen = useAtomValue(boardEpicAtom);
  const setChosen = useAtomSet(boardEpicAtom);
  const kinds = useAtomValue(boardKindsAtom);
  const setKinds = useAtomSet(boardKindsAtom);

  const me = identity?.pubkey ?? "";
  // everything, or one epic with open tickets: e goes round them
  const epics = boardEpics(tickets, me);
  const epic = epics.some((entry) => entry.epic.id === chosen) ? chosen : null;
  const views = [null, ...epics.map((entry) => entry.epic.id)];
  const nextView = () => setChosen(views[(views.indexOf(epic) + 1) % views.length] ?? null);
  const viewName = epic === null ? "all tickets" : rowTitle(epics.find((entry) => entry.epic.id === epic)!.epic);
  // every kind, or only some: what each would leave is counted on the board without the filter
  const view = { epic, now: Date.now() };
  const everyKind = boardOf(tickets, trace, me, view);
  const counts = kindCounts(everyKind);
  const offered = BOARD_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0 || kinds.includes(kind)).map((kind) => ({ kind, count: counts.get(kind) ?? 0, on: kinds.includes(kind) }));
  const toggle = (kind: BoardKind) => setKinds(BOARD_KINDS.filter((each) => (each === kind ? !kinds.includes(each) : kinds.includes(each))));
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8));

  return (
    <Board
      lanes={kinds.length === 0 ? everyKind : boardOf(tickets, trace, me, { ...view, kinds })}
      filters={<Filters view={epics.length > 0 ? `${viewName} · ${views.indexOf(epic) + 1} of ${views.length}` : null} onNextView={nextView} kinds={offered} onToggle={toggle} />}
      onNextView={epics.length > 0 ? nextView : undefined}
      unread={unread}
      nameFor={nameFor}
      onOpen={(id) => navigate(to.ticket(id, "room/board"))}
      onReview={(id) => openReviewPage({ ticketId: id })}
      onBrowser={roomId ? () => openBoardPage({ roomId, epic, kinds }) : undefined}
    />
  );
}

/** What the board is read through, one row above it, as on the app's
 *  board: the epic — enter goes round them — then each kind with how many
 *  it shows, enter turning it on or off; none on is every kind. ←→ move
 *  along it, ↓ goes down into the board. */
function Filters({
  view,
  onNextView,
  kinds,
  onToggle,
}: {
  /** the epic it is read through and where that is among them; null when there are no epics to choose */
  view: string | null;
  onNextView: () => void;
  kinds: ReadonlyArray<{ readonly kind: BoardKind; readonly count: number; readonly on: boolean }>;
  onToggle: (kind: BoardKind) => void;
}) {
  const [at, setAt] = useState(0);
  // the epic first, when there is one to choose, then the kinds
  const items = [...(view !== null ? (["epic"] as const) : []), ...kinds.map((entry) => entry.kind)];
  const index = clamp(at, 0, Math.max(0, items.length - 1));
  const current = items[index];
  if (items.length === 0) return null;
  return (
    <Focusable
      id="board-filters"
      marginBottom={1}
      hint={`←→ choose · enter ${current === "epic" ? "next epic" : "show or hide this kind"} · ↓ the board`}
      flexDirection="row"
      flexShrink={0}
      onKey={(key) => {
        if (key.name === "left" && index > 0) return setAt(index - 1), true;
        if (key.name === "right" && index < items.length - 1) return setAt(index + 1), true;
        if (isEnter(key) || isSpace(key)) {
          if (current === "epic") onNextView();
          else if (current) onToggle(current);
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <text wrapMode="none" truncate>
          {view !== null ? (
            <>
              <span fg={focused && current === "epic" ? theme.accent : theme.dim}>{focused && current === "epic" ? "› " : "  "}epic </span>
              <span fg={theme.epic}>{view}</span>
            </>
          ) : null}
          {kinds.map((entry) => {
            const here = focused && current === entry.kind;
            return (
              <span key={entry.kind} fg={here ? theme.accent : entry.on ? theme.fg : theme.dim}>
                {here ? "  › " : "    "}
                {entry.on ? "● " : ""}
                {kindGlyph(entry.kind)} {entry.kind}s {entry.count}
              </span>
            );
          })}
        </text>
      )}
    </Focusable>
  );
}

/** The three columns and the cursor across them; what a key opens is the page's to say. */
export function Board({
  lanes,
  filters,
  onNextView,
  unread,
  nameFor,
  onOpen,
  onReview,
  onBrowser,
}: {
  lanes: ReadonlyArray<Lane>;
  /** the row above it saying what it is read through: the epic, the kinds */
  filters: ReactNode;
  /** e: the next view — the next epic, or everything again */
  onNextView: (() => void) | undefined;
  /** tickets a newer collagen wrote, which the board cannot place */
  unread: number;
  nameFor: (key: string) => string;
  /** enter: the ticket's page */
  onOpen: (ticketId: string) => void;
  /** o on a review: its page in the browser */
  onReview: (ticketId: string) => void;
  /** b: this board in the browser */
  onBrowser: (() => void) | undefined;
}) {
  const cursor = useAtomValue(boardCursorAtom);
  const setCursor = useAtomSet(boardCursorAtom);
  // the ticket under the cursor, wherever it is now; or, gone, the place it was
  const found = cursor.id === null ? -1 : lanes.findIndex((candidate) => candidate.rows.some((row) => row.ticket.id === cursor.id));
  const column = found >= 0 ? found : clamp(cursor.col, 0, lanes.length - 1);
  const lane = lanes[column]!;
  const row = found >= 0 ? lane.rows.findIndex((candidate) => candidate.ticket.id === cursor.id) : clamp(cursor.row, 0, Math.max(0, lane.rows.length - 1));
  const current = lane.rows[row];
  const select = (toColumn: number, toRow: number) => {
    const rows = lanes[toColumn]!.rows;
    const at = clamp(toRow, 0, Math.max(0, rows.length - 1));
    setCursor({ id: rows[at]?.ticket.id ?? null, col: toColumn, row: at });
  };

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} minHeight={0}>
    {filters}
    <Focusable
      id="board"
      hint={`←→ column · ↑↓ select · enter open${onNextView ? " · e next epic" : ""}${current?.ticket.kind === "review" ? " · o review in browser" : ""}${onBrowser ? " · b board in browser" : ""}`}
      flexDirection="row"
      gap={2}
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      onKey={(key) => {
        if (key.name === "up" && row > 0) return select(column, row - 1), true;
        if (key.name === "down" && row < lane.rows.length - 1) return select(column, row + 1), true;
        // the same height in the next column, or its last ticket
        if (key.name === "left" && column > 0) return select(column - 1, row), true;
        if (key.name === "right" && column < lanes.length - 1) return select(column + 1, row), true;
        if (isEnter(key)) {
          if (current) onOpen(current.ticket.id);
          return true;
        }
        if (key.name === "o" && current?.ticket.kind === "review") return onReview(current.ticket.id), true;
        if (key.name === "b" && onBrowser) return onBrowser(), true;
        if (key.name === "e" && onNextView) return onNextView(), true;
        // ↑ from a column's top reaches the tab bar; ← and → at the ends, what sits beside
        return false;
      }}
    >
      {(focused) =>
        lanes.map((each, index) => <LaneView key={each.column} lane={each} selected={index === column ? row : null} focused={focused} nameFor={nameFor} />)
      }
    </Focusable>
    {unread > 0 ? (
      <text fg={theme.dim} wrapMode="none" truncate flexShrink={0}>
        {"  "}
        {unreadLine(unread)}
      </text>
    ) : null}
    </box>
  );
}

/** One column: its heading — with ▸ and how many are yours now, when any
 *  are — and its tickets, scrolling inside it. */
function LaneView({ lane, selected, focused, nameFor }: { lane: Lane; selected: number | null; focused: boolean; nameFor: (key: string) => string }) {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const yours = lane.rows.filter((row) => row.summary.state === "needs-you").length;
  // a line of work is one stack: the latest at its head, what it grew from tucked under it
  const under = new Set(lane.stacks.flatMap((stack) => stack.slice(1).map((row) => row.ticket.id)));
  const current = selected === null ? undefined : lane.rows[selected];
  // the count stays whole; the heading is cut at its end to make room for it
  const count = yours > 0 ? `  ${GLYPH.yours} ${yours}` : "";
  const label = `  ${BOARD_LABEL[lane.column]}`;
  const heading = width === undefined ? label : clip(label, Math.max(0, width - cells(count)));
  return (
    <box flexDirection="column" flexGrow={1} flexBasis={0} flexShrink={1} minWidth={0} minHeight={0}>
      <text wrapMode="none" truncate flexShrink={0}>
        <span fg={selected !== null && focused ? theme.accent : theme.fg}>{heading}</span>
        {count ? <span fg={theme.warn}>{count}</span> : null}
      </text>
      {lane.rows.length === 0 ? (
        <text fg={theme.dim} wrapMode="none" truncate>
          {"  "}none
        </text>
      ) : (
        <FollowScroll follow={current ? (selected === 0 ? "start" : { id: cardId(current.ticket.id) }) : null} onWidth={setWidth}>
          {lane.stacks.flatMap((stack, at) => [
            // a line of work of more than one stands apart from what is beside it, a blank line on each side
            ...(at > 0 && (stack.length > 1 || lane.stacks[at - 1]!.length > 1) ? [<box key={`gap-${stack[0]!.ticket.id}`} height={1} flexShrink={0} />] : []),
            ...stack.map((row) => (
              <Card key={row.ticket.id} row={row} under={under.has(row.ticket.id)} selected={focused && lane.rows[selected ?? -1]?.ticket.id === row.ticket.id} width={width} nameFor={nameFor} />
            )),
          ])}
        </FollowScroll>
      )}
      {lane.older > 0 ? (
        <text fg={theme.dim} wrapMode="none" truncate flexShrink={0}>
          {"  "}
          {lane.older} older
        </text>
      ) : null}
    </box>
  );
}

/** Before a card's title: the cursor, the ▸, the kind's glyph — two columns each. */
const HEAD = 6;

/** A ticket on the board, one line: the cursor, ▸ when it is yours now,
 *  its kind, its title, and at the right edge whose it is — "you" bright, a
 *  name dim — or, closed as dropped, that it was. The title gives way first;
 *  the name goes when there is no room for both. */
function Card({ row: { ticket, summary }, under, selected, width, nameFor }: { row: Row; under: boolean; selected: boolean; width: number | undefined; nameFor: (key: string) => string }) {
  const dim = summary.state === "done" || summary.state === "closed" || summary.held.length > 0;
  const colour = selected ? theme.accent : dim ? theme.dim : theme.fg;
  const after = closedAs(ticket) === "dropped" ? "dropped" : clip(nameFor(ticket.createdBy), 8);
  // under the head of its stack: a branch's width given up by its title
  const room = width === undefined ? undefined : width - HEAD - (under ? 2 : 0);
  const withName = room === undefined || room - cells(after) - 1 >= MIN_TITLE;
  // the name at the card's right edge, so the names read down a column
  const fit = room === undefined ? rowTitle(ticket) : clip(rowTitle(ticket), withName ? room - cells(after) - 1 : room);
  const title = room === undefined || !withName ? fit : fit + " ".repeat(Math.max(0, room - cells(after) - 1 - cells(fit)));
  return (
    <box id={cardId(ticket.id)} flexDirection="row" flexShrink={0}>
      <text wrapMode="none" truncate fg={colour}>
        {selected ? "› " : "  "}
        <span fg={theme.warn}>{summary.state === "needs-you" ? `${GLYPH.yours} ` : "  "}</span>
        {under ? <span fg={theme.dim}>└ </span> : null}
        <span fg={theme.dim}>{kindGlyph(ticket.kind)} </span>
        {title}
        {withName ? <span fg={summary.mine && after === "you" ? theme.accent : theme.dim}> {after}</span> : null}
      </text>
    </box>
  );
}

/** The fewest columns a title keeps before the name beside it is dropped. */
const MIN_TITLE = 12;

/** The id a card is drawn under, so its column can keep it in view. */
const cardId = (ticketId: string): string => `card-${ticketId}`;
