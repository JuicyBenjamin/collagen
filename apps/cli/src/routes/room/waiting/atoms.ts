import { Effect } from "effect";
import type { Waiter } from "../../../lib/roomHealth";
import { Rooms } from "../../../services/Rooms";
import { runtimeAtom } from "../../../app/runtime";

/** Why an answer to someone waiting did not go through, in a few words. */
const REFUSED = {
  NotPermitted: "your role here does not let people in",
  NotWritable: "you are not let in to this room yourself yet",
  PeerNotConnected: "they are no longer connected",
} as const;

/** Let someone in to the room being looked at: the one whose invite waits
 *  on a yes gets it; the one at the door with no invite is handed one and
 *  comes in with it. Null when done, else why not. */
export const letInAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ waiter }: { waiter: Waiter }) {
    const { room } = yield* (yield* Rooms).current;
    return yield* (waiter.at === null ? room.letInAtDoor(waiter.key) : room.admit(waiter.key)).pipe(
      Effect.match({ onSuccess: () => null, onFailure: (refusal) => REFUSED[refusal._tag] }),
    );
  }),
);

/** Turn away someone whose invite waits on a yes. Null when done, else why not. */
export const turnAwayAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ waiter }: { waiter: Waiter }) {
    const { room } = yield* (yield* Rooms).current;
    return yield* room.decline(waiter.key).pipe(Effect.match({ onSuccess: () => null, onFailure: (refusal) => REFUSED[refusal._tag] }));
  }),
);
