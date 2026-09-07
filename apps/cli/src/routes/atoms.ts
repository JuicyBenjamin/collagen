import { Effect, Stream, SubscriptionRef } from "effect";
import { IdentityService } from "../services/Identity";
import { Rooms } from "../services/Rooms";
import { runtimeAtom } from "../app/runtime";

// Only what more than one frame reads (the room frame AND settings). Atoms a
// single frame or section reads live next to it.

/** Your display name, live (settings change it without a restart). */
export const myNameAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* IdentityService).nameRef);
  })),
);

/** The room being looked at: id + its shared name. Follows focus changes and
 *  renames alike. */
export const roomAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    const rooms = yield* Rooms;
    return rooms.watch((h) => SubscriptionRef.changes(h.room.meta).pipe(Stream.map((m) => ({ id: h.id, name: m.name }))));
  })),
);
