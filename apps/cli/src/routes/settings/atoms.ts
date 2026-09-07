import { Effect } from "effect";
import { IdentityService } from "../../services/Identity";
import { Rooms } from "../../services/Rooms";
import { runtimeAtom } from "../../app/runtime";

// Only the settings frame changes these.

/** Change your display name now — peers see it on the next profile broadcast. */
export const setMyNameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const ident = yield* IdentityService;
    yield* ident.setName(name);
  }),
);

/** Rename the focused room for everyone in it (broadcast, last-writer-wins). */
export const renameRoomAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const { room } = yield* (yield* Rooms).current;
    yield* room.rename(name);
  }),
);
