import { Atom } from "effect/unstable/reactivity";
import { Layer, Option } from "effect";
import { AppLayer } from "../services/AppLayer";
import { cliArgsLayer } from "../services/CliArgs";

export interface CliArgs {
  profile: string;
  name: Option.Option<string>;
  room: Option.Option<string>;
}

// The runtime is built lazily, on the first atom subscription, from whatever
// was set here last — so the entry (or the setup frame) can finish resolving
// name and room before anything expensive starts.
let cliArgs: CliArgs = { profile: "default", name: Option.none(), room: Option.none() };
export function setCliArgs(args: CliArgs): void {
  cliArgs = args;
}

/** The whole app (swarm, MCP server, spawner, daemons) lives behind this atom.
 *  keepAlive: the app must keep running even if no component observes it.
 *  Every route-level atom derives from it. */
export const runtimeAtom = Atom.keepAlive(
  Atom.runtime(() => AppLayer.pipe(Layer.provide(cliArgsLayer(cliArgs)))),
);
