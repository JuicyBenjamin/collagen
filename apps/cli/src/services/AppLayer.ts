import { join } from "node:path";
import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { NodeServices } from "@effect/platform-node";
import { Swarm, SwarmConfig } from "@collagen/p2p";
import { AdaptersLive } from "./Adapters";
import { AiStatus } from "./AiStatus";
import { AgentRunner } from "./AgentRunner";
import { loadDevBootstrap } from "./DevBootstrap";
import { Dispatch } from "./Dispatch";
import { configDir, IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { LogBuffer, LoggerLive } from "./Logging";
import { McpInfo } from "./McpInfo";
import { McpLive } from "./Mcp";
import { Outbox } from "./Outbox";
import { registerAll } from "./Registrar";
import { Rooms } from "./Rooms";
import { Scripting } from "./Scripting";
import { StateStore } from "./StateStore";
import { Updates } from "./Updates";

/** Process-wide background rules (per-room ones live in Rooms): re-probe the
 *  agent CLI when the preferred ai changes; register our MCP server with the
 *  agent CLIs once it is up. */
const Daemons = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* StateStore;
    const aiStatus = yield* AiStatus;
    yield* SubscriptionRef.changes(store.state).pipe(
      Stream.map((s) => s.preferredAi),
      Stream.changes,
      Stream.tap((ai) => aiStatus.refresh(ai)),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* registerAll.pipe(Effect.forkScoped);
  }),
);

/** One swarm for this identity; every room is a topic on it. */
const SwarmLive = Swarm.layer.pipe(
  Layer.provide(
    Layer.effect(
      SwarmConfig,
      Effect.gen(function* () {
        const { identity } = yield* IdentityService;
        return {
          identity,
          bootstrap: Option.getOrUndefined(yield* loadDevBootstrap),
          storage: join(configDir, `store-${identity.profile}`),
        };
      }),
    ),
  ),
);

/** The whole app apart from the UI. Requires CliArgs.
 *  Process layer (identity, state, inbox, agents, MCP) wraps the room layer
 *  (Rooms: every joined room live, one focused, on one swarm). */
export const AppLayer = Layer.mergeAll(Daemons, McpLive).pipe(
  Layer.provideMerge(Updates.layer),
  Layer.provideMerge(Outbox.layer),
  Layer.provideMerge(Dispatch.layer),
  Layer.provideMerge(Scripting.layer),
  Layer.provideMerge(Rooms.layer),
  Layer.provideMerge(SwarmLive),
  Layer.provideMerge(AgentRunner.layer),
  Layer.provideMerge(AiStatus.layer),
  Layer.provideMerge(AdaptersLive),
  Layer.provideMerge(Inbox.layer),
  Layer.provideMerge(McpInfo.layer),
  Layer.provideMerge(StateStore.layer),
  Layer.provideMerge(IdentityService.layer),
  Layer.provideMerge(LoggerLive),
  Layer.provideMerge(LogBuffer.layer),
  Layer.provideMerge(NodeServices.layer),
);
