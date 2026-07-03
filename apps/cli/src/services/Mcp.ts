import { createServer } from "node:http";
import { Effect, Layer, Schema, SubscriptionRef } from "effect";
import { McpServer, Tool, Toolkit } from "@effect/ai";
import { HttpRouter, HttpServer } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { Room, RoomMessage } from "@collagen/p2p";
import { portForProfile } from "../util";
import { CliArgs } from "./CliArgs";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";

const RoomView = Schema.Struct({
  name: Schema.String,
  ai: Schema.NullOr(Schema.String),
  projects: Schema.Array(Schema.String),
});

const ListRoom = Tool.make("list-room", {
  description:
    "List the peers currently in your collagen room and the projects each shares. Call this first to discover who you can contact and about which project.",
  parameters: {},
  success: Schema.Array(RoomView),
});

const SendToPeer = Tool.make("send-to-peer", {
  description:
    "Send a finding or request to a peer in the room about a specific project. The peer's AI will be triggered with your message. Use a 'peer' name and 'project' from list-room. 'intent' is a short verb like 'flag-issue' or 'ask-review'. 'findings' is the full context plus what you want from them.",
  parameters: {
    peer: Schema.String,
    project: Schema.String,
    intent: Schema.String,
    findings: Schema.String,
  },
  success: Schema.String,
});

const GetMessages = Tool.make("get-messages", {
  description:
    "Retrieve and clear messages sent to you. Pass the threadId you were given to get just this conversation's messages. Each includes the sender, project, intent, and findings — use them to pick up the conversation and act on the request.",
  parameters: {
    threadId: Schema.optional(Schema.String),
  },
  success: Schema.Array(RoomMessage),
});

export const CollagenToolkit = Toolkit.make(ListRoom, SendToPeer, GetMessages);

export const ToolHandlers = CollagenToolkit.toLayer(
  Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;
    return {
      "list-room": () =>
        SubscriptionRef.get(room.roster).pipe(
          Effect.map((peers) =>
            peers.map((p) => ({ name: p.name, ai: p.ai, projects: p.projects.map((x) => x.name) })),
          ),
        ),
      "send-to-peer": ({ peer, project, intent, findings }) =>
        Effect.gen(function* () {
          const peers = yield* SubscriptionRef.get(room.roster);
          const target = peers.find((p) => p.name === peer);
          if (!target) return `failed: no peer named ${peer}`;
          return yield* room.sendTo(target.key, { project, intent, findings }).pipe(
            Effect.map(() => `sent to ${peer}`),
            Effect.catchTag("PeerNotConnected", () => Effect.succeed("failed: peer not connected")),
          );
        }),
      "get-messages": ({ threadId }) => inbox.take(threadId),
    };
  }),
);

/** MCP server over Streamable HTTP on the profile's deterministic port
 *  (ephemeral fallback if taken). Publishes the resolved URL to McpInfo. */
export const McpLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const mcpInfo = yield* McpInfo;

    // Reads the *actual* bound address (matters for the port-0 fallback).
    const announce = Layer.effectDiscard(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const addr = server.address;
        if (addr._tag === "TcpAddress") {
          yield* mcpInfo.set(`http://127.0.0.1:${addr.port}/mcp`);
        }
      }),
    );

    const serve = (port: number) =>
      Layer.mergeAll(McpServer.toolkit(CollagenToolkit), HttpRouter.Default.serve(), announce).pipe(
        Layer.provide(ToolHandlers),
        Layer.provide(
          McpServer.layerHttp({ name: "collagen", version: "0.0.0", path: "/mcp" }),
        ),
        Layer.provide(NodeHttpServer.layer(createServer, { port })),
      );

    return serve(portForProfile(profile)).pipe(Layer.orElse(() => serve(0)));
  }),
);
