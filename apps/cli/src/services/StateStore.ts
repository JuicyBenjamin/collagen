import { join } from "node:path";
import { Context, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { FileSystem } from "effect";
import { LocalState } from "@collagen/p2p";
import { CliArgs } from "./CliArgs";
import { configDir } from "./Identity";

const StateFile = Schema.fromJsonString(LocalState);
const emptyState: LocalState = { preferredAi: null, pool: [], rooms: {} };

/** Per-profile LocalState in a SubscriptionRef, persisted on every update. */
export class StateStore extends Context.Service<StateStore>()("cli/StateStore", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const fs = yield* FileSystem.FileSystem;
    const file = join(configDir, `state-${profile}.json`);

    const initial = yield* fs.readFileString(file).pipe(
      Effect.flatMap(Schema.decodeEffect(StateFile)),
      Effect.orElseSucceed(() => emptyState),
    );
    const state = yield* SubscriptionRef.make<LocalState>(initial);

    const persist = (s: LocalState) =>
      Schema.encodeEffect(StateFile)(s).pipe(
        Effect.flatMap((json) => fs.writeFileString(file, json)),
        Effect.catch((e) => Effect.logWarning(`state persist failed: ${String(e)}`)),
      );

    const update = (f: (s: LocalState) => LocalState) =>
      SubscriptionRef.updateAndGet(state, f).pipe(Effect.flatMap(persist));

    return { state, update, get: SubscriptionRef.get(state) } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
