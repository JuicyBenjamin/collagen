import { Effect, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { openInBrowser } from "../../../lib/opener";
import { roomMerges } from "../../../services/MergeHistory";
import { ReviewPages } from "../../../services/ReviewLive";
import { Rooms } from "../../../services/Rooms";
import { StateStore } from "../../../services/StateStore";
import { runtimeAtom } from "../../../app/runtime";

/** The focused room's projects held here, each with its merges: read from
 *  the host when the tab opens, the room changes, or the reader asks again
 *  — merges are not pushed to us, and a read is a few calls to the host.
 *  null while a room's are being read, so another room's are never shown
 *  under this one. */
export const mergesAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    const rooms = yield* Rooms;
    const store = yield* StateStore;
    return rooms.watch((h) => Stream.concat(Stream.succeed(null), Stream.fromEffect(roomMerges(h.id).pipe(Effect.provideService(StateStore, store)))));
  })),
);

/** The row the cursor is on, by what it is — kept while the reader opens a
 *  ticket and comes back, and when a read brings new merges in above it. */
export const mergesCursorAtom = Atom.keepAlive(Atom.make<string | null>(null));

/** o on a merge: its pull request in the person's browser. What happened
 *  goes to the activity log, url included, for a machine with no browser. */
export const openLinkAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ url }: { url: string }) {
    const ok = yield* openInBrowser(url);
    yield* Effect.log(ok ? `opened: ${url}` : `${url} (could not open a browser — paste it into one)`);
  }),
);

/** w: the focused room's merge history as a web page, in the person's
 *  browser (ReviewPages.showMerges). */
export const openMergesPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* () {
    const room = yield* (yield* Rooms).current;
    yield* Effect.log(yield* (yield* ReviewPages).showMerges(room.id));
  }),
);
