import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { NodeServices } from "@effect/platform-node";
import { Room, RoomConfig, roomProjects } from "@collagen/p2p";
import { AdaptersLive } from "./Adapters";
import { AgentRunner } from "./AgentRunner";
import { loadDevBootstrap } from "./DevBootstrap";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { LogBuffer, LoggerLive } from "./Logging";
import { McpInfo } from "./McpInfo";
import { McpLive } from "./Mcp";
import { registerAll } from "./Registrar";
import { Scripting } from "./Scripting";
import { StateStore } from "./StateStore";

export const ROOM = "lobby";

/** Room wiring: identity + live profile (re-read from state on every broadcast). */
const RoomConfigLive = Layer.effect(
  RoomConfig,
  Effect.gen(function* () {
    const { identity } = yield* IdentityService;
    const store = yield* StateStore;
    const bootstrap = yield* loadDevBootstrap;
    return {
      identity,
      roomName: ROOM,
      getProfile: store.get.pipe(
        Effect.map((s) => ({
          name: identity.name,
          ai: s.preferredAi,
          projects: roomProjects(s, ROOM).map((p) => ({ name: p.name, path: p.path })),
        })),
      ),
      bootstrap: Option.getOrUndefined(bootstrap),
    };
  }),
);

/** Background rules that make the app *behave*: incoming message → inbox +
 *  agent run; state change → profile re-broadcast; MCP up → register in AIs. */
const Daemons = Layer.effectDiscard(
  Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;
    const runner = yield* AgentRunner;
    const store = yield* StateStore;

    yield* room.messages.pipe(
      Stream.tap((m) => Effect.log(`← ${m.fromName} [${m.project}/${m.intent}]`)),
      Stream.tap((m) => inbox.push(m)),
      // fork: a running agent must not block message intake
      Stream.tap((m) => Effect.forkChild(runner.runThread(m.threadId))),
      Stream.runDrain,
      Effect.forkScoped,
    );

    yield* SubscriptionRef.changes(store.state).pipe(
      Stream.drop(1), // skip the initial value — peers got it on connect
      Stream.tap(() => room.updateProfile),
      Stream.runDrain,
      Effect.forkScoped,
    );

    yield* registerAll.pipe(Effect.forkScoped);
  }),
);

/** The whole app apart from the UI. Requires CliArgs. */
export const AppLayer = Layer.mergeAll(Daemons, McpLive).pipe(
  Layer.provideMerge(AgentRunner.layer),
  Layer.provideMerge(Scripting.layer),
  Layer.provideMerge(AdaptersLive),
  Layer.provideMerge(Room.layer),
  Layer.provideMerge(RoomConfigLive),
  Layer.provideMerge(Inbox.layer),
  Layer.provideMerge(McpInfo.layer),
  Layer.provideMerge(StateStore.layer),
  Layer.provideMerge(IdentityService.layer),
  Layer.provideMerge(LoggerLive),
  Layer.provideMerge(LogBuffer.layer),
  Layer.provideMerge(NodeServices.layer),
);
