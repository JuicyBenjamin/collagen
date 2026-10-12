import { createHash } from "node:crypto";
import { Effect, Stream, SubscriptionRef } from "effect";
import { BOARD_LABEL, closedAs, shortRoomId } from "@collagen/p2p";
import type { BoardData } from "@collagen/review-web/data";
import { boardOf, unreadLine, unreadTickets } from "../lib/board";
import { kindGlyph } from "../lib/ticketTabs";
import { rowTitle } from "../lib/ticketSummary";
import { IdentityService } from "./Identity";
import { Rooms } from "./Rooms";

// The board in the browser: a room's tickets in to do, in progress and
// done — the terminal's board (lib/board, on p2p's boardColumn), drawn by
// the page at /board/<short room id>. Read-only, on loopback, like the
// review page. The url names the room by its short id: the full one is the
// invite, and a url is kept in the browser's history.

/** A short room id (shortRoomId); anything else is not looked up. */
export const shortIdOk = (id: string | undefined): id is string => id !== undefined && /^[0-9a-f]{8}$/.test(id);

/** The room this instance is in that a short id names. */
const roomNamed = (shortId: string) =>
  Effect.gen(function* () {
    return (yield* SubscriptionRef.get((yield* Rooms).handles)).find((handle) => shortRoomId(handle.id) === shortId);
  });

/** The room's board for this instance's person, all of it read at one moment. */
export const boardData = Effect.fn("BoardView.data")(function* (shortId: string) {
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
  return {
    room: meta.name,
    lanes: boardOf([...tickets.values()], trace, me).map((lane) => ({
      column: lane.column,
      label: BOARD_LABEL[lane.column],
      cards: lane.rows.map(({ ticket, summary }) => ({
        id: ticket.id,
        kind: ticket.kind,
        glyph: kindGlyph(ticket.kind),
        title: rowTitle(ticket),
        goal: ticket.goal,
        author: nameFor(ticket.createdBy),
        mine: summary.mine,
        yours: summary.state === "needs-you",
        dropped: closedAs(ticket) === "dropped",
      })),
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
