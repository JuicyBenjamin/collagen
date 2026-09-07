import { Effect, Stream } from "effect";
import { Rooms } from "../../../../services/Rooms";
import { runtimeAtom } from "../../../../app/runtime";

// Only the rooms sidebar reads/uses these.

/** Every room this profile is in — one summary line each, live. */
export const roomSummariesAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).summaryChanges;
  })),
);

/** Look at another room: instant, and peers see you move (away elsewhere). */
export const focusRoomAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ id }: { id: string }) {
    yield* (yield* Rooms).setFocus(id);
  }),
);

/** Leave the room under the cursor (refused for the only room). */
export const leaveRoomAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ id }: { id: string }) {
    const outcome = yield* (yield* Rooms).leave(id);
    if (outcome !== "left") yield* Effect.logWarning(outcome);
  }),
);
