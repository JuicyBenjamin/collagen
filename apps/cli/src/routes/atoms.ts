import { Effect, Stream, SubscriptionRef } from "effect";
import { Room } from "@collagen/p2p";
import { IdentityService } from "../services/Identity";
import { runtimeAtom } from "../app/runtime";

// Only what more than one frame reads (the room frame AND settings). Atoms a
// single frame or section reads live next to it.

/** Your display name, live (settings change it without a restart). */
export const myNameAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* IdentityService).nameRef);
  })),
);

/** The room's shared name — live view of what the room agreed on (LWW). */
export const roomMetaAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Room).meta);
  })),
);
