import { Layer, Option } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { parseArgs } from "node:util";
import { AppLayer } from "./services/AppLayer";
import { cliArgsLayer } from "./services/CliArgs";

// Headless mode: the full app (room, MCP server, agent spawner) without the
// TUI. For development and for running collagen on machines with no terminal
// attached. Observe via COLLAGEN_LOG=<file>.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    name: { type: "string", short: "n" },
    profile: { type: "string", short: "p" },
  },
  allowPositionals: true,
});

const layer = AppLayer.pipe(
  Layer.provide(
    cliArgsLayer({
      profile: values.profile ?? "default",
      name: Option.fromNullable(values.name),
    }),
  ),
);

NodeRuntime.runMain(Layer.launch(layer));
