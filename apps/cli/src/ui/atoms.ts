import { Atom } from "@effect-atom/atom-react";
import { Effect, Layer, Option, Stream } from "effect";
import { Room, type LocalState } from "@collagen/p2p";
import { AppLayer } from "../services/AppLayer";
import { cliArgsLayer } from "../services/CliArgs";
import { IdentityService } from "../services/Identity";
import { Inbox } from "../services/Inbox";
import { LogBuffer } from "../services/Logging";
import { McpInfo } from "../services/McpInfo";
import { StateStore } from "../services/StateStore";

// The entry sets parsed CLI args before the first render; Layer.suspend defers
// reading them until the runtime actually builds (first atom subscription).
let cliArgs: { profile: string; name: Option.Option<string> } = {
  profile: "default",
  name: Option.none(),
};
export function setCliArgs(args: typeof cliArgs): void {
  cliArgs = args;
}

/** The whole app (swarm, MCP server, spawner, daemons) lives behind this atom.
 *  keepAlive: the app must keep running even if no component observes it. */
export const runtimeAtom = Atom.runtime(
  Layer.suspend(() => AppLayer.pipe(Layer.provide(cliArgsLayer(cliArgs)))),
).pipe(Atom.keepAlive);

export const identityAtom = runtimeAtom.atom(
  Effect.map(IdentityService, (s) => s.identity),
);

export const rosterAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.map(Room, (r) => r.roster.changes)),
);

export const stateAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.map(StateStore, (s) => s.state.changes)),
);

export const recentMessagesAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.map(Inbox, (i) => i.recent.changes)),
);

export const logsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.map(LogBuffer, (b) => b.lines.changes)),
);

export const mcpUrlAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.map(McpInfo, (m) => m.url.changes)),
);

/** All state mutations funnel through here: pass a reducer, StateStore
 *  persists and the daemons re-broadcast the profile. */
export const updateStateAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (f: (s: LocalState) => LocalState) {
    const store = yield* StateStore;
    yield* store.update(f);
  }),
);
