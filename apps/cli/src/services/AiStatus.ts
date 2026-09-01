import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { AiStatus as Status } from "@collagen/p2p";
import { Adapters } from "./Adapters";

/** Probes whether an agent CLI is installed and authenticated, using the
 *  adapter's cheap auth command (no model call). The result is broadcast in
 *  the room profile, so an unauthenticated peer is visible to everyone. */
export class AiStatus extends Context.Service<AiStatus>()("cli/AiStatus", {
  make: Effect.gen(function* () {
    const adapters = yield* Adapters;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const current = yield* SubscriptionRef.make<Status>("unknown");

    const probe = Effect.fn("AiStatus.probe")(
      function* (ai: string | null) {
        if (ai === null) return "unknown" as const;
        const adapter = adapters[ai];
        if (!adapter) return "missing" as const;
        const handle = yield* ChildProcess.make(adapter.cmd, adapter.auth.args, { stdin: "ignore" });
        const out = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
        const exit = yield* handle.exitCode;
        return adapter.auth.loggedIn(out, exit) ? ("ok" as const) : ("unauthenticated" as const);
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          // spawn failure = binary not found (or not runnable) = missing
          Effect.orElseSucceed(() => "missing" as const),
        ),
    );

    /** Probe and publish — the profile broadcaster reads `current`. */
    const refresh = Effect.fn("AiStatus.refresh")(function* (ai: string | null) {
      const status = yield* probe(ai);
      yield* SubscriptionRef.set(current, status);
      yield* Effect.log(`ai status: ${ai ?? "none"} → ${status}`);
      return status;
    });

    return { current, refresh } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
