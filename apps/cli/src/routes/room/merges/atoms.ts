import { Effect, Stream } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type { LocalState } from "@collagen/p2p";
import { sameName } from "../../../lib/names";
import { openInBrowser } from "../../../lib/opener";
import { inProjectOrder, projectOrderOf } from "../../../lib/projectOrder";
import { MergeHistory } from "../../../services/MergeHistory";
import { ReviewPages } from "../../../services/ReviewLive";
import { Rooms } from "../../../services/Rooms";
import { runtimeAtom } from "../../../app/runtime";
import { roomAtom } from "../../atoms";
import { stateAtom } from "../atoms";

/** The focused room's merges of one project held here: read from the host
 *  when its tab opens, the room changes, or the reader refreshes, and more
 *  as they scroll on (MergeHistory) — merges are not pushed to us. null
 *  while they are being read, so another room's are never shown under this
 *  one. */
export const mergesAtom = Atom.family((project: string) =>
  runtimeAtom.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const rooms = yield* Rooms;
        const history = yield* MergeHistory;
        return rooms.watch((handle) => history.view(handle.id, project));
      }),
    ),
  ),
);

/** The project whose merges are shown, by name: null, the person's first —
 *  as it is each time the tab is opened (useTabs). Kept while the reader
 *  opens a ticket and comes back. */
export const mergesProjectAtom = Atom.keepAlive(Atom.make<string | null>(null));

/** The projects held here, in the person's order, and the one whose merges
 *  are shown: the one chosen while it is still here, else the first — the
 *  tab, its row of projects and `o` all go by it. */
export const mergesShownAtom = Atom.make((get) => {
  const roomId = AsyncResult.getOrElse(get(roomAtom), () => ({ id: "", name: "" })).id;
  const state = AsyncResult.getOrElse(get(stateAtom), (): LocalState => ({ preferredAi: null, rooms: {} }));
  const chosen = get(mergesProjectAtom);
  const projects = inProjectOrder(state.rooms[roomId] ?? [], (project) => project.name, projectOrderOf(state, roomId)).map((project) => project.name);
  return { projects, shown: projects.find((project) => chosen !== null && sameName(project, chosen)) ?? projects[0] };
});

/** r: the focused room's merges, read from scratch. */
export const refreshMergesAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* () {
    const room = yield* (yield* Rooms).current;
    yield* (yield* MergeHistory).refresh(room.id);
  }),
);

/** The cursor nears the end of a project's `count` merges: show more. */
export const moreMergesAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ project, count }: { project: string; count: number }) {
    const room = yield* (yield* Rooms).current;
    yield* (yield* MergeHistory).more(room.id, project, count);
  }),
);

/** The row the cursor is on, by what it is — kept while the reader opens a
 *  ticket and comes back, and when a read brings new merges in above it. */
export const mergesCursorAtom = Atom.keepAlive(Atom.make<string | null>(null));

/** p on a merge: its pull request in the person's browser. What happened
 *  goes to the activity log, url included, for a machine with no browser. */
export const openLinkAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ url }: { url: string }) {
    const ok = yield* openInBrowser(url);
    yield* Effect.log(ok ? `opened: ${url}` : `${url} (could not open a browser — paste it into one)`);
  }),
);

/** o: a project's merges as a web page, in the person's browser
 *  (ReviewPages.showMerges) — at a merge, when the cursor is on one; with
 *  no project, the room's, which goes on to the person's first. */
export const openMergesPageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ project, at }: { project?: string; at?: number }) {
    const room = yield* (yield* Rooms).current;
    yield* Effect.log(yield* (yield* ReviewPages).showMerges(room.id, project, at));
  }),
);
