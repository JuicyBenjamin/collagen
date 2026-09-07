import { Deferred, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app/app";
import { nameOption, profileOption, roomOption, stripArgSeparator } from "./config/args";
import { readProfileFile, storedRoom } from "./config/profileFile";
import { setCliArgs } from "./app/runtime";

const command = Command.make("collagen", { profile: profileOption, name: nameOption, room: roomOption }, (args) =>
  Effect.gen(function* () {
    // Resolve config before anything renders: flags override the stored
    // profile; a missing name or room means first run (the setup frame).
    const stored = readProfileFile(args.profile);
    const name = Option.getOrUndefined(args.name) ?? stored.name;
    const flagRoomId = Option.getOrUndefined(args.room);
    const room =
      flagRoomId !== undefined
        ? { id: flagRoomId, name: storedRoom(stored)?.id === flagRoomId ? storedRoom(stored)!.name : flagRoomId.slice(0, 8) }
        : storedRoom(stored);
    setCliArgs({
      profile: args.profile,
      name: name === undefined ? Option.none() : Option.some(name),
      room: room === undefined ? Option.none() : Option.some(room.id),
    });

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
        root.render(
          <App
            profile={args.profile}
            initialName={name ?? ""}
            configured={name !== undefined && room !== undefined}
            onExit={() => Deferred.doneUnsafe(done, Effect.void)}
          />,
        );
        return root;
      }),
      (root) => Effect.sync(() => root.unmount()),
    );

    yield* Deferred.await(done);
  }).pipe(Effect.scoped),
);

Command.runWith(command, { version: "0.0.0" })(stripArgSeparator(process.argv.slice(2))).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
