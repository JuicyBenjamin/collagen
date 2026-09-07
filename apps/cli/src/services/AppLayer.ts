import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import { NodeServices } from "@effect/platform-node";
import { AdaptersLive } from "./Adapters";
import { AiStatus } from "./AiStatus";
import { AgentRunner } from "./AgentRunner";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { LogBuffer, LoggerLive } from "./Logging";
import { McpInfo } from "./McpInfo";
import { McpLive } from "./Mcp";
import { registerAll } from "./Registrar";
import { Rooms } from "./Rooms";
import { Scripting } from "./Scripting";
import { StateStore } from "./StateStore";

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

/** The whole app apart from the UI. Requires CliArgs.
 *  Process layer (identity, state, inbox, agents, MCP) wraps the room layer
 *  (Rooms: every joined room live, one focused). */
export const AppLayer = Layer.mergeAll(Daemons, McpLive).pipe(
  Layer.provideMerge(Scripting.layer),
  Layer.provideMerge(Rooms.layer),
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
