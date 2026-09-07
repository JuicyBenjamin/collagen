import { Effect, Stream, SubscriptionRef } from "effect";
import { type LocalState } from "@collagen/p2p";
import { AiStatus } from "../../services/AiStatus";
import { IdentityService } from "../../services/Identity";
import { Rooms } from "../../services/Rooms";
import { StateStore } from "../../services/StateStore";
import { runtimeAtom } from "../../app/runtime";

// Read by the room layout and/or more than one of its sections. Everything
// room-scoped follows the FOCUSED room — switch rooms and these re-subscribe.

export const identityAtom = runtimeAtom.atom(
  Effect.gen(function* () {
    return (yield* IdentityService).identity;
  }),
);

/** Local per-user state: preferred ai, per-room projects, adopted threads. */
export const stateAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* StateStore).state);
  })),
);

/** All state mutations funnel through here: pass a reducer, StateStore
 *  persists and the daemons re-broadcast the profile.
 *  The reducer is WRAPPED in an object: atom-react treats a bare function
 *  argument to a setter as an updater of the atom's own value (which is an
 *  AsyncResult, not our state) — that ambiguity silently ate every update. */
export const updateStateAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ update }: { update: (s: LocalState) => LocalState }) {
    const store = yield* StateStore;
    yield* store.update(update);
  }),
);

/** Whether the preferred agent CLI is installed and authenticated. */
export const aiStatusAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* AiStatus).current);
  })),
);

/** Peers present in the focused room (emits the current value on subscribe). */
export const rosterAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.roster));
  })),
);

/** Everyone the focused room's log remembers — names for offline peers. */
export const membersAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.members));
  })),
);

/** Every message in the focused room, in log order — the a2a trace. */
export const traceAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.trace));
  })),
);

/** Whether we can write to the focused room's log yet (a member admits us). */
export const admittedAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Rooms).watch((h) => SubscriptionRef.changes(h.room.writable));
  })),
);
