import { Effect } from "effect";
import { Atom } from "effect/reactivity";
import type { BoardKind } from "../../../lib/board";
import { ReviewPages } from "../../../services/ReviewLive";
import { runtimeAtom } from "../../../app/runtime";

/** b on the board: the same board, the same view, in the person's browser.
 *  What happened goes to the activity log, url included, for a machine with no browser. */
export const openBoardPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ roomId, epic, kinds }: { roomId: string; epic: string | null; kinds: ReadonlyArray<BoardKind> }) {
    yield* Effect.log(yield* (yield* ReviewPages).showBoard(roomId, epic, kinds));
  }),
);

/** The epic the board is read through — null: everything — kept while the
 *  reader opens a ticket and comes back. */
export const boardEpicAtom = Atom.keepAlive(Atom.make<string | null>(null));

/** The kinds the board shows — none: every kind — kept as the epic is. */
export const boardKindsAtom = Atom.keepAlive(Atom.make<ReadonlyArray<BoardKind>>([]));

/** Where the board's cursor is — the ticket it is on, and its place — kept
 *  while the reader opens a ticket and comes back. */
export const boardCursorAtom = Atom.keepAlive(Atom.make<{ readonly id: string | null; readonly col: number; readonly row: number }>({ id: null, col: 0, row: 0 }));
