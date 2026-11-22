import { Effect, Stream, SubscriptionRef } from "effect";
import { LogBuffer } from "../../../services/Logging";
import { runtimeAtom } from "../../../app/runtime";

/** What this collagen has been doing, oldest first, as lines arrive. */
export const logsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* LogBuffer).lines);
  })),
);
