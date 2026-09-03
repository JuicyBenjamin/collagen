import { useState } from "react";
import { Deferred, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { nameOption, profileOption, roomOption } from "./args";
import { v7 as uuidv7 } from "uuid";
import { readProfileFile, storedRoom, upsertActiveRoom, writeProfileFile } from "./profileFile";
import { App } from "./ui/App";
import { SetupWizard } from "./ui/Setup";
import { setCliArgs, setResolvedRoom } from "./ui/atoms";
import { stripArgSeparator } from "./util";

/** Setup gate: until name+room are known (flags, stored profile, or the
 *  first-run form) nothing subscribes to the app atoms, so the swarm/MCP
 *  runtime only builds once the user is configured. */
function Root({
  profile,
  initialName,
  needsSetup,
  onExit,
}: {
  profile: string;
  initialName: string;
  needsSetup: boolean;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<"setup" | "app">(needsSetup ? "setup" : "app");
  if (phase === "setup") {
    return (
      <SetupWizard
        initialName={initialName}
        onDone={({ name, mode, roomName, roomId }) => {
          // create: fresh unguessable id; join: the pasted invite IS the id,
          // labeled by its short prefix until the user renames it in settings.
          const id = mode === "create" ? uuidv7() : roomId;
          const label = mode === "create" ? roomName : roomId.slice(0, 8);
          writeProfileFile(profile, { name });
          upsertActiveRoom(profile, { id, name: label });
          setCliArgs({ profile, name: Option.some(name), room: Option.some(id) });
          setResolvedRoom({ id, name: label });
          setPhase("app");
        }}
      />
    );
  }
  return <App onExit={onExit} />;
}

const command = Command.make("collagen", { profile: profileOption, name: nameOption, room: roomOption }, (args) =>
  Effect.gen(function* () {
    // Resolve config before anything renders: flags override the stored
    // profile; missing pieces trigger the setup form.
    const stored = readProfileFile(args.profile);
    const name = Option.getOrUndefined(args.name) ?? stored.name;
    const flagRoomId = Option.getOrUndefined(args.room);
    const room =
      flagRoomId !== undefined
        ? { id: flagRoomId, name: storedRoom(stored)?.id === flagRoomId ? storedRoom(stored)!.name : flagRoomId.slice(0, 8) }
        : storedRoom(stored);
    const needsSetup = name === undefined || room === undefined;
    setCliArgs({
      profile: args.profile,
      name: name === undefined ? Option.none() : Option.some(name),
      room: room === undefined ? Option.none() : Option.some(room.id),
    });
    if (room !== undefined) setResolvedRoom(room);

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
          <Root
            profile={args.profile}
            initialName={name ?? ""}
            needsSetup={needsSetup}
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
