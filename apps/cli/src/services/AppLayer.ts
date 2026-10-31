import { join } from "node:path";
import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { NodeServices } from "@effect/platform-node";
import { MergeHistory } from "./MergeHistory";
import { Swarm, SwarmConfig } from "@collagen/p2p";
import { AdaptersLive } from "./Adapters";
import { HarnessesLive } from "./Harness";
import { Jobs } from "./Jobs";
import { AiStatus } from "./AiStatus";
import { shownAi } from "../lib/jobs";
import { AgentRunner } from "./AgentRunner";
import { loadDevBootstrap } from "./DevBootstrap";
import { Dispatch } from "./Dispatch";
import { configDir, IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { LogBuffer, LoggerLive } from "./Logging";
import { McpInfo } from "./McpInfo";
import { McpLive } from "./Mcp";
import { MergerDaemon } from "./Merger";
import { Outbox } from "./Outbox";
import { registerAll } from "./Registrar";
import { Rooms } from "./Rooms";
import { Scripting } from "./Scripting";
import { StateStore } from "./StateStore";
import { Transcripts } from "./Transcripts";
import { Attachments } from "./Attachments";
import { Updates } from "./Updates";
import { ReviewTypes } from "./ReviewTypes";
import { ReviewPages } from "./ReviewLive";

/** Process-wide background rules (per-room ones live in Rooms): re-probe the
 *  agent CLI when the preferred ai changes; register our MCP server with the
 *  agent CLIs once it is up. */
const Daemons = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* StateStore;
    const aiStatus = yield* AiStatus;
    yield* SubscriptionRef.changes(store.state).pipe(
      Stream.map(shownAi),
      Stream.changes,
      Stream.tap((preferredAi) => aiStatus.refresh(preferredAi)),
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
export const AppLayer = Layer.mergeAll(Daemons, McpLive, MergerDaemon).pipe(
  Layer.provideMerge(ReviewTypes.layer),
  Layer.provideMerge(ReviewPages.layer),
  Layer.provideMerge(MergeHistory.layer),
  Layer.provideMerge(Updates.layer),
  Layer.provideMerge(Attachments.layer),
  Layer.provideMerge(Transcripts.layer),
  Layer.provideMerge(Outbox.layer),
  Layer.provideMerge(Dispatch.layer),
  Layer.provideMerge(Scripting.layer),
).pipe(
  Layer.provideMerge(Rooms.layer),
  Layer.provideMerge(SwarmLive),
  Layer.provideMerge(Jobs.layer),
  Layer.provideMerge(AgentRunner.layer),
  Layer.provideMerge(AiStatus.layer),
  Layer.provideMerge(AdaptersLive),
  Layer.provideMerge(HarnessesLive),
  Layer.provideMerge(Inbox.layer),
  Layer.provideMerge(McpInfo.layer),
  Layer.provideMerge(StateStore.layer),
  Layer.provideMerge(IdentityService.layer),
  Layer.provideMerge(LoggerLive),
  Layer.provideMerge(LogBuffer.layer),
  Layer.provideMerge(NodeServices.layer),
);
