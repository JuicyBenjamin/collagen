import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { nameOption, profileOption, roomOption, stripArgSeparator } from "./config/args";
import { AppLayer } from "./services/AppLayer";
import { cliArgsLayer } from "./services/CliArgs";

// Headless mode: the full app (room, MCP server, agent spawner) without the
// TUI. For development and for running collagen on machines with no terminal
// attached. Observe via COLLAGEN_LOG=<file>.
const command = Command.make("collagen-headless", { profile: profileOption, name: nameOption, room: roomOption }, (args) =>
  Layer.launch(AppLayer.pipe(Layer.provide(cliArgsLayer(args)))),
);

Command.runWith(command, { version: "0.0.0" })(stripArgSeparator(process.argv.slice(2))).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
