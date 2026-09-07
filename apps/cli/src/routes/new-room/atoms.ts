import { Effect } from "effect";
import type { RoomEntry } from "../../config/profileFile";
import { Rooms } from "../../services/Rooms";
import { runtimeAtom } from "../../app/runtime";

/** Join (or create) a room live and look at it. Same path the agent's
 *  create-room / join-room tools take. */
export const joinRoomAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ entry }: { entry: RoomEntry }) {
    yield* (yield* Rooms).join(entry, true);
  }),
);
