import { Effect } from "effect";
import { Atom } from "effect/reactivity";
import { ReviewPages } from "../../../services/ReviewLive";
import { runtimeAtom } from "../../../app/runtime";

/** b on the board: the same board in the person's browser. What happened
 *  goes to the activity log, url included, for a machine with no browser. */
export const openBoardPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ roomId }: { roomId: string }) {
    yield* Effect.log(yield* (yield* ReviewPages).showBoard(roomId));
  }),
);

/** Where the board's cursor is — the ticket it is on, and its place — kept
 *  while the reader opens a ticket and comes back. */
export const boardCursorAtom = Atom.keepAlive(Atom.make<{ readonly id: string | null; readonly col: number; readonly row: number }>({ id: null, col: 0, row: 0 }));
