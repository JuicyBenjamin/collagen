import { Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { render } from "ink";
import { App } from "./ui/App";
import { setCliArgs } from "./ui/atoms";

const profile = Options.text("profile").pipe(
  Options.withAlias("p"),
  Options.withDescription("Config profile (separate identity/state; used for local dev pairs)"),
  Options.withDefault("default"),
);
const name = Options.text("name").pipe(
  Options.withAlias("n"),
  Options.withDescription("Display name shown to peers (persisted per profile)"),
  Options.optional,
);

const command = Command.make("collagen", { profile, name }, (args) =>
  Effect.gen(function* () {
    // The app's Effect runtime is owned by the atom registry (ui/atoms.ts);
    // args must be in place before the first atom builds it.
    setCliArgs(args);

    // Use the terminal's alternate screen so Ink owns a bounded viewport —
    // frames redraw in place instead of stacking into scrollback.
    const isTty = Boolean(process.stdout.isTTY);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        if (isTty) process.stdout.write("\x1b[?1049h");
      }),
      () =>
        Effect.sync(() => {
          if (isTty) process.stdout.write("\x1b[?1049l");
        }),
    );

    const instance = yield* Effect.acquireRelease(
      Effect.sync(() => render(<App />)),
      (i) => Effect.sync(() => i.unmount()),
    );
    yield* Effect.promise(() => instance.waitUntilExit());
  }).pipe(Effect.scoped),
);

const cli = Command.run(command, { name: "collagen", version: "0.0.0" });

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
