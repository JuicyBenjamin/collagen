import { Effect, Stream, SubscriptionRef } from "effect";
import { Room } from "@collagen/p2p";
import { runtimeAtom } from "../../../../../app/runtime";

/** Shared tickets as an array, oldest activity first. Only this section reads it. */
export const ticketsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Room).tickets).pipe(
      Stream.map((m) => [...m.values()].sort((a, b) => a.updatedAt - b.updatedAt)),
    );
  })),
);
