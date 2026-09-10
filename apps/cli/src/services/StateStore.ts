import { join } from "node:path";
import { Context, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { FileSystem } from "effect";
import { LocalState } from "@collagen/p2p";
import { emptyState, salvageState } from "../lib/localState";
import { CliArgs } from "./CliArgs";
import { configDir } from "./Identity";

const StateFile = Schema.fromJsonString(LocalState);

/** Per-profile LocalState in a SubscriptionRef, persisted on every update. */
export class StateStore extends Context.Service<StateStore>()("cli/StateStore", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const fs = yield* FileSystem.FileSystem;
    const file = join(configDir, `state-${profile}.json`);

    // The file is salvaged, never thrown away: whatever still reads is kept,
    // what an older build left behind is dropped, named, and written back —
    // losing a stale proposal must never cost the user their rooms.
    const salvaged = yield* fs.readFileString(file).pipe(
      Effect.map(salvageState),
      Effect.orElseSucceed(() => ({ state: emptyState, dropped: [] as ReadonlyArray<string> })),
    );
    const state = yield* SubscriptionRef.make<LocalState>(salvaged.state);

    const persist = (s: LocalState) =>
      Schema.encodeEffect(StateFile)(s).pipe(
        Effect.flatMap((json) => fs.writeFileString(file, json)),
        Effect.catch((e) => Effect.logWarning(`state persist failed: ${String(e)}`)),
      );

    const update = (f: (s: LocalState) => LocalState) =>
      SubscriptionRef.updateAndGet(state, f).pipe(Effect.flatMap(persist));

    if (salvaged.dropped.length > 0) {
      yield* Effect.logWarning(`state file: dropped ${salvaged.dropped.join(", ")} written by an older build — the rest is intact`);
      yield* persist(salvaged.state);
    }

    return { state, update, get: SubscriptionRef.get(state) } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
