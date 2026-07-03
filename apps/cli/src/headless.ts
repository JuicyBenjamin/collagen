import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { nameOption, profileOption } from "./args";
import { AppLayer } from "./services/AppLayer";
import { cliArgsLayer } from "./services/CliArgs";

// Headless mode: the full app (room, MCP server, agent spawner) without the
// TUI. For development and for running collagen on machines with no terminal
// attached. Observe via COLLAGEN_LOG=<file>.
const command = Command.make("collagen-headless", { profile: profileOption, name: nameOption }, (args) =>
  Layer.launch(AppLayer.pipe(Layer.provide(cliArgsLayer(args)))),
);

const cli = Command.run(command, { name: "collagen (headless)", version: "0.0.0" });

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
