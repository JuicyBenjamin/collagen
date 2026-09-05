import { Atom } from "effect/unstable/reactivity";
import { Effect, Option, Stream, SubscriptionRef } from "effect";
import { Layer } from "effect";
import { Room, type LocalState } from "@collagen/p2p";
import { AiStatus } from "../services/AiStatus";
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
let cliArgs: { profile: string; name: Option.Option<string>; room: Option.Option<string> } = {
  profile: "default",
  name: Option.none(),
  room: Option.none(),
};
export function setCliArgs(args: typeof cliArgs): void {
  cliArgs = args;
}

// The entry resolves flag/stored/setup-form into a concrete room before the
// runtime builds; the UI reads it here.
let resolvedRoom: { id: string; name: string } = { id: "", name: "" };
export function setResolvedRoom(room: { id: string; name: string }): void {
  resolvedRoom = room;
}
/** The room this process joined — fixed for the process lifetime. */
export function currentRoom(): { id: string; name: string } {
  return resolvedRoom;
}
export function currentProfile(): string {
  return cliArgs.profile;
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

/** Messages this instance sent — the other half of the a2a trace. */
export const sentMessagesAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Room).sent);
  })),
);

/** Shared tickets, as an array (newest activity last). */
export const ticketsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Room).tickets).pipe(
      Stream.map((m) => [...m.values()].sort((a, b) => a.updatedAt - b.updatedAt)),
    );
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

export const aiStatusAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* AiStatus).current);
  })),
);

/** The room's shared display name — updates live when any peer renames it. */
export const roomMetaAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* Room).meta);
  })),
);

/** Rename the room for everyone in it (broadcast, last-writer-wins). */
export const renameRoomAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const room = yield* Room;
    yield* room.rename(name);
  }),
);

/** Your display name, live (settings change it without a restart). */
export const myNameAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* IdentityService).nameRef);
  })),
);

/** Change your display name now — peers see it on the next profile broadcast. */
export const setMyNameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const ident = yield* IdentityService;
    yield* ident.setName(name);
  }),
);

/** All state mutations funnel through here: pass a reducer, StateStore
 *  persists and the daemons re-broadcast the profile.
 *  The reducer is WRAPPED in an object: atom-react treats a bare function
 *  argument to a setter as an updater of the atom's own value (which is an
 *  AsyncResult, not our state) — that ambiguity silently ate every update. */
export const updateStateAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ update }: { update: (s: LocalState) => LocalState }) {
    const store = yield* StateStore;
    yield* store.update(update);
  }),
);
