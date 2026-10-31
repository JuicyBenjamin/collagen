import { Effect } from "effect";
import { Rooms } from "../../services/Rooms";
import { runtimeAtom } from "../../app/runtime";

// Only the rename page changes this.

/** Rename the room being looked at, for everyone in it (last writer wins). */
export const renameRoomAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const { room } = yield* (yield* Rooms).current;
    yield* room.rename(name);
  }),
);
