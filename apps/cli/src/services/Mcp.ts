import { createServer } from "node:http";
import { Effect, Layer, Schema, SubscriptionRef } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { Room, RoomMessage } from "@collagen/p2p";
import { portForProfile } from "../util";
import { CliArgs } from "./CliArgs";
import { Inbox } from "./Inbox";
import { Scripting } from "./Scripting";
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
  // no `parameters`: an empty Schema.Struct({}) produces a JSON schema without
  // "type", which the MCP tool codec rejects at registration
  success: Schema.Struct({ peers: Schema.Array(RoomView) }),
});

const SendToPeer = Tool.make("send-to-peer", {
  description:
    "Send a finding or request to a peer in the room about a specific project. The peer's AI will be triggered with your message. Use a 'peer' name and 'project' from list-room. 'intent' is a short verb like 'flag-issue' or 'ask-review'. 'findings' is the full context plus what you want from them.",
  parameters: Schema.Struct({
    peer: Schema.String,
    project: Schema.String,
    intent: Schema.String,
    findings: Schema.String,
  }),
  success: Schema.String,
});

const GetMessages = Tool.make("get-messages", {
  description:
    "Retrieve and clear messages sent to you. Pass the threadId you were given to get just this conversation's messages. Each includes the sender, project, intent, and findings — use them to pick up the conversation and act on the request.",
  parameters: Schema.Struct({
    threadId: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ messages: Schema.Array(RoomMessage) }),
});

const ExecuteScript = Tool.make("execute", {
  description:
    "Run a CallScript program against collagen's tools (collagen.listRoom, collagen.sendToPeer, collagen.getMessages). Write a small JS program — it is compiled to an inert plan, never executed as code — to compose several collagen calls in one shot (e.g. list the room, then fan a message out to every peer sharing a project). Call describe-scripting first for the language card and tool signatures.",
  parameters: Schema.Struct({
    script: Schema.String,
    input: Schema.optional(Schema.Unknown),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
});

const SearchTools = Tool.make("search-tools", {
  description: "Search the tools mounted on the CallScript engine by keyword.",
  parameters: Schema.Struct({ query: Schema.String }),
  success: Schema.Struct({ matches: Schema.String }),
});

const DescribeScripting = Tool.make("describe-scripting", {
  description:
    "The CallScript language card plus the signatures of every mounted collagen tool. Read this before writing a script for the execute tool.",
  success: Schema.Struct({ card: Schema.String }),
});

export const CollagenToolkit = Toolkit.make(
  ListRoom,
  SendToPeer,
  GetMessages,
  ExecuteScript,
  SearchTools,
  DescribeScripting,
);

export const ToolHandlers = CollagenToolkit.toLayer(
  Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;
    const scripting = yield* Scripting;

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
      "get-messages": ({ threadId }: { threadId?: string }) =>
        inbox.take(threadId).pipe(
          Effect.map((messages) => ({ messages })),
          Effect.withSpan("Mcp.getMessages"),
        ),
      execute: ({ script, input }: { script: string; input?: unknown }) =>
        Effect.promise(() => scripting.execute(script, input)).pipe(
          Effect.map((result) => ({ ...result }) as Record<string, unknown>),
          Effect.withSpan("Mcp.execute"),
        ),
      "search-tools": ({ query }: { query: string }) =>
        Effect.promise(() => scripting.search(query)).pipe(
          Effect.map((matches) => ({ matches })),
          Effect.withSpan("Mcp.searchTools"),
        ),
      "describe-scripting": () =>
        Effect.sync(() => ({ card: scripting.describe() })).pipe(Effect.withSpan("Mcp.describeScripting")),
    };
  }),
);

/** MCP server over Streamable HTTP on the profile's deterministic port
 *  (ephemeral fallback if taken). Publishes the resolved URL to McpInfo.
 *
 *  v4's protocol adapters own JSON-RPC framing and notification responses,
 *  so the v3-era workarounds (singleton-batch unwrapping, 202-on-empty) are
 *  gone. Newer spec revisions (e.g. stateless 2026-07-28) slot in by adding
 *  their adapter to `protocols` once effect ships it. */
export const McpLive = Layer.unwrap(
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
      HttpRouter.serve(
        Layer.mergeAll(
          McpServer.toolkit(CollagenToolkit).pipe(Layer.provide(ToolHandlers)),
          announce,
        ).pipe(
          Layer.provideMerge(
            McpServer.layerHttp({
              name: "collagen",
              version: "0.0.0",
              path: "/mcp",
              protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
            }),
          ),
        ),
        { disableListenLog: true },
      ).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port })));

    return serve(portForProfile(profile)).pipe(Layer.catch(() => serve(0)));
  }),
);
