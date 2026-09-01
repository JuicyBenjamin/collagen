import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Deferred, Effect } from "effect";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { nameOption, profileOption } from "./args";
import { App } from "./ui/App";
import { setCliArgs } from "./ui/atoms";
import { stripArgSeparator } from "./util";

const command = Command.make("collagen", { profile: profileOption, name: nameOption }, (args) =>
  Effect.gen(function* () {
    // The app's Effect runtime is owned by the atom registry (ui/atoms.ts);
    // args must be in place before the first atom builds it.
    setCliArgs(args);

    // Resolved when the UI asks to quit (q); the scope then tears down the
    // React root and the renderer (which restores the terminal).
    const done = yield* Deferred.make<void>();

    // OpenTUI owns the terminal: alternate screen, raw input, in-place redraw.
    const renderer = yield* Effect.acquireRelease(
      Effect.promise(() => createCliRenderer({ screenMode: "alternate-screen", exitOnCtrlC: true })),
      (r) => Effect.sync(() => r.destroy()),
    );

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const root = createRoot(renderer);
        root.render(<App onExit={() => Deferred.unsafeDone(done, Effect.void)} />);
        return root;
      }),
      (root) => Effect.sync(() => root.unmount()),
    );

    yield* Deferred.await(done);
  }).pipe(Effect.scoped),
);

const cli = Command.run(command, { name: "collagen", version: "0.0.0" });

cli(stripArgSeparator(process.argv)).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
