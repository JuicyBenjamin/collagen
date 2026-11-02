import { createHash } from "node:crypto";
import { Clock, Effect, Stream, SubscriptionRef } from "effect";
import { BOARD_LABEL, closedAs, KIND_ORDER, shortRoomId } from "@collagen/p2p";
import type { BoardData, BoardKind } from "@collagen/review-web/data";
import { boardEpics, boardOf, kindCounts, unreadLine, unreadTickets } from "../lib/board";
import type { Row } from "../lib/ticketGroups";
import { kindGlyph } from "../lib/ticketTabs";
import { rowTitle } from "../lib/ticketSummary";
import { IdentityService } from "./Identity";
import { Rooms } from "./Rooms";

// The board in the browser: a room's tickets in to do, in progress and
// done — the terminal's board (lib/board, on p2p's boardColumn), drawn by
// the page at /room/<short room id>/board. Read-only, on loopback, like the
// review page. The url names the room by its short id: the full one is the
// invite, and a url is kept in the browser's history.

/** A short room id (shortRoomId); anything else is not looked up. */
export const shortIdOk = (id: string | undefined): id is string => id !== undefined && /^[0-9a-f]{8}$/.test(id);

/** The kinds a board can be filtered to: every kind but epic, which is a view, not a card. */
export const BOARD_KINDS: ReadonlyArray<BoardKind> = KIND_ORDER.filter((kind): kind is BoardKind => kind !== "epic");

/** A list of board kinds from the page, each once. */
export const boardKindsOk = (kinds: unknown): kinds is ReadonlyArray<BoardKind> =>
  Array.isArray(kinds) && kinds.length <= BOARD_KINDS.length && kinds.every((kind) => BOARD_KINDS.includes(kind)) && new Set(kinds).size === kinds.length;

/** The room this instance is in that a short id names. */
const roomNamed = (shortId: string) =>
  Effect.gen(function* () {
    return (yield* SubscriptionRef.get((yield* Rooms).handles)).find((handle) => shortRoomId(handle.id) === shortId);
  });

/** The room's board for this instance's person, all of it read at one
 *  moment: everything, or one epic's (by its id or the start of it); every
 *  kind, or only some; the done column what finished lately, or all of it. */
export const boardData = Effect.fn("BoardView.data")(function* (shortId: string, epic: string | null = null, allDone = false, kinds: ReadonlyArray<BoardKind> = []) {
  const handle = yield* roomNamed(shortId);
  if (!handle) return null;
  const { room } = handle;
  const me = (yield* IdentityService).identity.pubkey;
  const [tickets, trace, roster, members, meta, unseen] = [
    yield* SubscriptionRef.get(room.tickets),
    yield* SubscriptionRef.get(room.trace),
    yield* SubscriptionRef.get(room.roster),
    yield* SubscriptionRef.get(room.members),
    yield* SubscriptionRef.get(room.meta),
    yield* SubscriptionRef.get(room.unseen),
  ];
  const unread = unreadTickets(unseen);
  const nameFor = (key: string): string =>
    key === me ? "you" : (roster.find((person) => person.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8));
  const card = ({ ticket, summary }: Row) => ({
    id: ticket.id,
    kind: ticket.kind,
    glyph: kindGlyph(ticket.kind),
    title: rowTitle(ticket),
    goal: ticket.goal,
    author: nameFor(ticket.createdBy),
    mine: summary.mine,
    yours: summary.state === "needs-you",
    dropped: closedAs(ticket) === "dropped",
  });
  const epics = boardEpics([...tickets.values()], me);
  const chosen = epic ? (epics.find((entry) => entry.epic.id === epic || entry.epic.id.startsWith(epic))?.epic.id ?? null) : null;
  const view = { epic: chosen, allDone, now: yield* Clock.currentTimeMillis };
  const everyKind = boardOf([...tickets.values()], trace, me, view);
  const lanes = kinds.length === 0 ? everyKind : boardOf([...tickets.values()], trace, me, { ...view, kinds });
  const counts = kindCounts(everyKind);
  return {
    room: meta.name,
    epics: epics.map((entry) => ({ id: entry.epic.id, title: rowTitle(entry.epic), open: entry.open })),
    epic: chosen,
    kinds: BOARD_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0 || kinds.includes(kind)).map((kind) => ({ kind, glyph: kindGlyph(kind), label: `${kind}s`, count: counts.get(kind) ?? 0 })),
    chosen: kinds,
    lanes: lanes.map((lane) => ({
      column: lane.column,
      label: BOARD_LABEL[lane.column],
      stacks: lane.stacks.map((stack) => stack.map(card)),
      older: lane.older,
    })),
    unread: unread > 0 ? unreadLine(unread) : null,
  } satisfies BoardData;
});
/** The board as a token for an open page — a hash of what it shows —
 *  current first, then each time that moves: a ticket, a message (the
 *  order within a column follows activity), a name, a ticket unread. */
export const boardChanges = (shortId: string): Stream.Stream<string, never, Rooms | IdentityService> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const handle = yield* roomNamed(shortId);
      if (!handle) return Stream.empty;
      const { room } = handle;
      const token = boardData(shortId).pipe(Effect.map((board) => createHash("sha1").update(JSON.stringify(board)).digest("hex")));
      const moved: Array<Stream.Stream<unknown>> = [
        SubscriptionRef.changes(room.tickets),
        SubscriptionRef.changes(room.trace),
        SubscriptionRef.changes(room.roster),
        SubscriptionRef.changes(room.members),
        SubscriptionRef.changes(room.meta),
        SubscriptionRef.changes(room.unseen),
      ];
      return Stream.mergeAll(moved, { concurrency: "unbounded" }).pipe(Stream.mapEffect(() => token), Stream.changes);
    }),
  );
