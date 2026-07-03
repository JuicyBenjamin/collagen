import { createServer } from "node:http";
import { Effect, Layer, Schema, SubscriptionRef } from "effect";
import { McpServer, Tool, Toolkit } from "@effect/ai";
import { HttpApp, HttpMiddleware, HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { RpcSerialization, RpcServer } from "@effect/rpc";
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

// NOTE: tool results must be OBJECT-rooted — the MCP spec types
// `structuredContent` as an object, and Claude Code rejects array roots.
const ListRoom = Tool.make("list-room", {
  description:
    "List the peers currently in your collagen room and the projects each shares. Call this first to discover who you can contact and about which project.",
  parameters: {},
  success: Schema.Struct({ peers: Schema.Array(RoomView) }),
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
  success: Schema.Struct({ messages: Schema.Array(RoomMessage) }),
});

export const CollagenToolkit = Toolkit.make(ListRoom, SendToPeer, GetMessages);

export const ToolHandlers = CollagenToolkit.toLayer(
  Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;

    const sendToPeer = Effect.fn("Mcp.sendToPeer")(function* (input: {
      peer: string;
      project: string;
      intent: string;
      findings: string;
    }) {
      const peers = yield* SubscriptionRef.get(room.roster);
      const target = peers.find((p) => p.name === input.peer);
      if (!target) return `failed: no peer named ${input.peer}`;
      return yield* room
        .sendTo(target.key, { project: input.project, intent: input.intent, findings: input.findings })
        .pipe(
          Effect.map(() => `sent to ${input.peer}`),
          Effect.catchTag("PeerNotConnected", () => Effect.succeed("failed: peer not connected")),
        );
    });

    return {
      "list-room": () =>
        SubscriptionRef.get(room.roster).pipe(
          Effect.map((peers) => ({
            peers: peers.map((p) => ({ name: p.name, ai: p.ai, projects: p.projects.map((x) => x.name) })),
          })),
          Effect.withSpan("Mcp.listRoom"),
        ),
      "send-to-peer": sendToPeer,
      "get-messages": ({ threadId }) =>
        inbox.take(threadId).pipe(
          Effect.map((messages) => ({ messages })),
          Effect.withSpan("Mcp.getMessages"),
        ),
    };
  }),
);

/** Strict JSON-RPC serialization: the stock jsonRpc encoder batch-frames every
 *  HTTP response, so a single request gets a one-element ARRAY back — valid for
 *  @effect/rpc's own clients but a spec violation that strict MCP clients
 *  (codex's rmcp) reject at initialize. Unwrap singleton batches. */
const JsonRpcUnbatched = Layer.succeed(
  RpcSerialization.RpcSerialization,
  RpcSerialization.RpcSerialization.of({
    contentType: "application/json",
    includesFraming: false,
    unsafeMake: () => {
      const parser = RpcSerialization.jsonRpc().unsafeMake();
      return {
        decode: parser.decode,
        encode: (response) => {
          if (Array.isArray(response) && response.length === 0) return ""; // notification-only POST
          return parser.encode(Array.isArray(response) && response.length === 1 ? response[0] : response);
        },
      };
    },
  }),
);

/** Streamable HTTP: a POST carrying only notifications gets 202 Accepted with
 *  no body. The rpc protocol answers 200 + empty body, which strict clients
 *  fail to parse as JSON. Must be a pre-response handler — by the time plain
 *  middleware sees the response, HttpApp.toHandled has already written it. */
const NotificationsAccepted = HttpMiddleware.make((app) =>
  Effect.zipRight(
    HttpApp.appendPreResponseHandler((_req, res) => {
      const body = res.body;
      const empty =
        body._tag === "Empty" ||
        (body._tag === "Uint8Array" && body.body.length === 0) ||
        ("text" in body && (body as { text?: string }).text === "");
      return Effect.succeed(
        res.status === 200 && empty ? HttpServerResponse.empty({ status: 202 }) : res,
      );
    }),
    app,
  ),
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

    // layerHttp minus its baked-in serialization (see JsonRpcUnbatched above).
    const serve = (port: number) =>
      Layer.mergeAll(
        McpServer.toolkit(CollagenToolkit),
        HttpRouter.Default.serve(NotificationsAccepted),
        announce,
      ).pipe(
        Layer.provide(ToolHandlers),
        Layer.provide(McpServer.layer({ name: "collagen", version: "0.0.0" })),
        Layer.provide(RpcServer.layerProtocolHttp({ path: "/mcp" })),
        Layer.provide(JsonRpcUnbatched),
        Layer.provide(NodeHttpServer.layer(createServer, { port })),
      );

    return serve(portForProfile(profile)).pipe(Layer.orElse(() => serve(0)));
  }),
);
