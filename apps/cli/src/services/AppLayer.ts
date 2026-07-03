import { Effect, Layer, Option, Stream } from "effect";
import { NodeContext } from "@effect/platform-node";
import { Room, RoomConfig, loadDevBootstrap, roomProjects } from "@collagen/p2p";
import { AgentRunner } from "./AgentRunner";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { LogBuffer, LoggerLive } from "./Logging";
import { McpInfo } from "./McpInfo";
import { McpLive } from "./Mcp";
import { registerAll } from "./Registrar";
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
const Daemons = Layer.scopedDiscard(
  Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;
    const runner = yield* AgentRunner;
    const store = yield* StateStore;

    yield* room.messages.pipe(
      Stream.tap((m) => Effect.log(`← ${m.fromName} [${m.project}/${m.intent}]`)),
      Stream.tap((m) => inbox.push(m)),
      // fork: a running agent must not block message intake
      Stream.tap((m) => Effect.fork(runner.runThread(m.threadId))),
      Stream.runDrain,
      Effect.forkScoped,
    );

    yield* store.state.changes.pipe(
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
  Layer.provideMerge(AgentRunner.Default),
  Layer.provideMerge(Room.Default),
  Layer.provideMerge(RoomConfigLive),
  Layer.provideMerge(Inbox.Default),
  Layer.provideMerge(McpInfo.Default),
  Layer.provideMerge(StateStore.Default),
  Layer.provideMerge(IdentityService.Default),
  Layer.provideMerge(LoggerLive),
  Layer.provideMerge(LogBuffer.Default),
  Layer.provideMerge(NodeContext.layer),
);
