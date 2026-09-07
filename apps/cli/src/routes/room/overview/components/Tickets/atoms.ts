import { Effect, Stream, SubscriptionRef } from "effect";
import { Rooms } from "../../../../../services/Rooms";
import { runtimeAtom } from "../../../../../app/runtime";

/** The focused room's shared tickets as an array, oldest activity first.
 *  Only this section reads it. */
export const ticketsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) =>
      SubscriptionRef.changes(h.room.tickets).pipe(
        Stream.map((m) => [...m.values()].sort((a, b) => a.updatedAt - b.updatedAt)),
      ),
    );
  })),
);
