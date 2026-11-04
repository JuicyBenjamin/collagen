import { Context, Effect, Layer, PubSub, Stream, SubscriptionRef } from "effect";

/** A settings tab, as the terminal names it. */
export type SettingsTab = "general" | "ai" | "tools";

/** A place in the terminal the person's agent takes them to: the room's
 *  steering, or the global settings, on a tab. `at` tells one ask from the
 *  next, so the same place asked twice is gone to twice. */
export interface Place {
  readonly to: "settings" | "global-settings";
  readonly tab: SettingsTab;
  readonly at: number;
}

/** Taking the person to a place in their terminal, for their agent
 *  (open-settings): the terminal follows what is asked, while it is open. A
 *  collagen running without its screen (headless) has nobody following, and
 *  says so rather than pretend. */
export class Places extends Context.Service<Places>()("cli/Places", {
  make: Effect.gen(function* () {
    const asked = yield* PubSub.unbounded<Place>();
    // how many screens follow: none, headless
    const following = yield* SubscriptionRef.make(0);

    /** The places asked for, for the terminal to go to; counted while it follows. */
    const follow: Stream.Stream<Place> = Stream.fromPubSub(asked).pipe(
      Stream.onStart(SubscriptionRef.update(following, (count) => count + 1)),
      Stream.ensuring(SubscriptionRef.update(following, (count) => count - 1)),
    );

    /** Go there: false when no terminal is open to go in. */
    const go = Effect.fn("Places.go")(function* (place: Omit<Place, "at">) {
      if ((yield* SubscriptionRef.get(following)) === 0) return false;
      yield* PubSub.publish(asked, { ...place, at: Date.now() });
      return true;
    });

    return { follow, go } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
