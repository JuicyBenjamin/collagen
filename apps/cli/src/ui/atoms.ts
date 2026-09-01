import { Atom } from "effect/unstable/reactivity";
import { Effect, Option, Stream, SubscriptionRef } from "effect";
import { Layer } from "effect";
import { Room, type LocalState } from "@collagen/p2p";
import { AppLayer } from "../services/AppLayer";
import { cliArgsLayer } from "../services/CliArgs";
import { IdentityService } from "../services/Identity";
import { Inbox } from "../services/Inbox";
import { LogBuffer } from "../services/Logging";
import { McpInfo } from "../services/McpInfo";
import { StateStore } from "../services/StateStore";

// The entry sets parsed CLI args before the first render; the lazy runtime
// factory defers reading them until the runtime actually builds (first atom
// subscription).
let cliArgs: { profile: string; name: Option.Option<string> } = {
  profile: "default",
  name: Option.none(),
};
export function setCliArgs(args: typeof cliArgs): void {
  cliArgs = args;
}

/** The whole app (swarm, MCP server, spawner, daemons) lives behind this atom.
 *  keepAlive: the app must keep running even if no component observes it. */
export const runtimeAtom = Atom.keepAlive(
  Atom.runtime(() => AppLayer.pipe(Layer.provide(cliArgsLayer(cliArgs)))),
);

export const identityAtom = runtimeAtom.atom(
  Effect.gen(function* () {
    return (yield* IdentityService).identity;
  }),
);

export const rosterAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Room).roster);
  })),
);

export const stateAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* StateStore).state);
  })),
);

export const recentMessagesAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Inbox).recent);
  })),
);

export const logsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* LogBuffer).lines);
  })),
);

export const mcpUrlAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* McpInfo).url);
  })),
);

/** All state mutations funnel through here: pass a reducer, StateStore
 *  persists and the daemons re-broadcast the profile. */
export const updateStateAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (f: (s: LocalState) => LocalState) {
    const store = yield* StateStore;
    yield* store.update(f);
  }),
);
