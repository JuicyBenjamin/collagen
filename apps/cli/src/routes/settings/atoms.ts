import { Effect } from "effect";
import { Room } from "@collagen/p2p";
import { IdentityService } from "../../services/Identity";
import { runtimeAtom } from "../../app/runtime";

// Only the settings frame changes these.

/** Change your display name now — peers see it on the next profile broadcast. */
export const setMyNameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const ident = yield* IdentityService;
    yield* ident.setName(name);
  }),
);

/** Rename the room for everyone in it (broadcast, last-writer-wins). */
export const renameRoomAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const room = yield* Room;
    yield* room.rename(name);
  }),
);
