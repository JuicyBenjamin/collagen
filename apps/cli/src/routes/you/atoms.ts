import { Effect, Stream, SubscriptionRef } from "effect";
import { IdentityService } from "../../services/Identity";
import { PersonService } from "../../services/Person";
import { runtimeAtom } from "../../app/runtime";

// Only the You page changes this.

/** Change your display name now — peers see it on the next profile broadcast. */
export const setMyNameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const ident = yield* IdentityService;
    yield* ident.setName(name);
    // …and your other devices take it too
    yield* (yield* PersonService).rememberName(name);
  }),
);

/** Your devices, as the acts stand: which is this one, which the parent. */
export const devicesAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* PersonService).state);
  })),
);

/** A device code for another machine of yours — ctrl+d copies it. Good for one machine, for ten minutes. */
export const deviceCodeAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* () {
    const made = yield* (yield* PersonService).makeCode();
    return made === "not-parent" ? ({ why: "only your parent device makes one" } as const) : made;
  }),
);
