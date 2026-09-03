import { createServer } from "node:http";
import { Clock, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { encode as toToon } from "@toon-format/toon";
import { Room, shortRoomId, type Ticket } from "@collagen/p2p";
import { portForProfile } from "../util";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { Scripting } from "./Scripting";
import { McpInfo } from "./McpInfo";

// NOTE: tool results must be OBJECT-rooted — the MCP spec types
// `structuredContent` as an object, and Claude Code rejects array roots.
/** Agent-facing ticket view: pubkeys resolved to peer names, uniform step
 *  rows (so TOON renders them as one compact table), threadId dropped (it
 *  equals the ticket id). */
const ticketView = (ticket: Ticket, nameFor: (key: string) => string) => ({
  id: ticket.id,
  project: ticket.project,
  goal: ticket.goal,
  createdBy: nameFor(ticket.createdBy),
  steps: ticket.steps.map((s) => ({
    id: s.id,
    owner: nameFor(s.owner),
    intent: s.intent,
    status: s.status,
    needs: s.needs.join("+"),
    description: s.description,
    result: s.result ?? "",
  })),
});

const ListRoom = Tool.make("list-room", {
  description:
    "List your current room (a stable short id plus its local label — the label can change, the short id never does) and the peers in it with the projects each shares. Call this first to discover who you can contact and about which project. otherRooms lists rooms this user has but is NOT currently in: peers, messages and tickets there are unreachable until the user switches rooms — if a request concerns one of those, say so instead of acting in the wrong room. Returns TOON (compact YAML/CSV-style) text.",
  // no `parameters`: an empty Schema.Struct({}) produces a JSON schema without
  // "type", which the MCP tool codec rejects at registration
  success: Schema.String,
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
  success: Schema.String,
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

const CreateTicket = Tool.make("create-ticket", {
  description:
    "Create a shared ticket: a structured, serialized record of a cross-peer task. Steps name an owner (a peer name from list-room, or yourself), an intent verb, a full description, and optional 'needs' (ids of steps that must settle first). The ticket is gossiped to the room; each owner's agent is triggered when its steps become actionable, and settles them with settle-step. Prefer this over send-to-peer for multi-step work — the intermediate state stays inspectable and survives restarts.",
  parameters: Schema.Struct({
    goal: Schema.String,
    project: Schema.String,
    steps: Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        owner: Schema.String,
        intent: Schema.String,
        description: Schema.String,
        needs: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  }),
  success: Schema.String,
});

const SettleStep = Tool.make("settle-step", {
  description:
    "Settle (or fail) a ticket step you own, with your findings as the result. The updated ticket is gossiped to the room; steps waiting on this one become actionable on their owners' side.",
  parameters: Schema.Struct({
    ticketId: Schema.String,
    stepId: Schema.String,
    result: Schema.String,
    failed: Schema.optional(Schema.Boolean),
  }),
  success: Schema.String,
});

const DrivePeer = Tool.make("drive-peer", {
  description:
    "TESTING ONLY: remote-control a mock peer (one whose ai starts with 'mock:') so a single machine can exercise the full cross-peer flow. The driven peer performs the action as itself, so everything arrives back through the real pipeline. Actions: 'send-message' (peer sends YOU a message — needs project/intent/findings; reusing a project continues the same thread), 'create-ticket' (peer creates a shared ticket — needs project/goal/steps, each step {intent, description, mine}; mine=true → the mock owns it, mine=false → you own it and your agent is triggered), 'settle-step' (peer settles a step it owns — needs ticketId/stepId/result). Real peers ignore drive requests.",
  parameters: Schema.Struct({
    peer: Schema.String,
    action: Schema.Literals(["send-message", "create-ticket", "settle-step"]),
    project: Schema.optional(Schema.String),
    intent: Schema.optional(Schema.String),
    findings: Schema.optional(Schema.String),
    goal: Schema.optional(Schema.String),
    steps: Schema.optional(
      Schema.Array(
        Schema.Struct({
          intent: Schema.String,
          description: Schema.String,
          mine: Schema.optional(Schema.Boolean),
        }),
      ),
    ),
    ticketId: Schema.optional(Schema.String),
    stepId: Schema.optional(Schema.String),
    result: Schema.optional(Schema.String),
  }),
  success: Schema.String,
});

const GetTickets = Tool.make("get-tickets", {
  description:
    "All shared tickets this instance knows, merged from the room. Includes step ownership, status, dependencies, and settled results. Returns TOON (compact YAML/CSV-style) text.",
  success: Schema.String,
});

export const CollagenToolkit = Toolkit.make(
  ListRoom,
  SendToPeer,
  GetMessages,
  ExecuteScript,
  SearchTools,
  DescribeScripting,
  CreateTicket,
  SettleStep,
  GetTickets,
);

/** Dev-only surface: everything plus the drive-peer test tool. A prod run
 *  never registers it — the tool doesn't exist there, it isn't just refused. */
export const DevCollagenToolkit = Toolkit.make(
  ListRoom,
  SendToPeer,
  GetMessages,
  ExecuteScript,
  SearchTools,
  DescribeScripting,
  CreateTicket,
  SettleStep,
  GetTickets,
  DrivePeer,
);

const makeHandlers = Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;
    const scripting = yield* Scripting;
    const { identity, room: roomInfo, knownRooms, nameRef } = yield* IdentityService;
    const renderTicket = Effect.fnUntraced(function* (ticket: Ticket) {
      const peers = yield* SubscriptionRef.get(room.roster);
      const myName = yield* SubscriptionRef.get(nameRef);
      const lookup = (key: string) =>
        key === identity.pubkey ? myName : (peers.find((p) => p.key === key)?.name ?? key.slice(0, 12));
      return ticketView(ticket, lookup);
    });

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
        Effect.all([SubscriptionRef.get(room.roster), SubscriptionRef.get(room.meta)]).pipe(
          Effect.map(([peers, meta]) =>
            toToon({
              room: { shortId: shortRoomId(roomInfo.id), name: meta.name },
              otherRooms: knownRooms
                .filter((r) => r.id !== roomInfo.id)
                .map((r) => ({ shortId: shortRoomId(r.id), name: r.name })),
              peers: peers.map((p) => ({
                name: p.name,
                ai: p.ai,
                aiStatus: p.aiStatus ?? "unknown",
                projects: p.projects.map((x) => x.name),
              })),
            }),
          ),
          Effect.withSpan("Mcp.listRoom"),
        ),
      "send-to-peer": sendToPeer,
      "get-messages": ({ threadId }: { threadId?: string }) =>
        inbox.take(threadId).pipe(
          Effect.map((messages) => toToon({ messages })),
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
      "create-ticket": Effect.fn("Mcp.createTicket")(function* (input: {
        goal: string;
        project: string;
        steps: ReadonlyArray<{
          id?: string;
          owner: string;
          intent: string;
          description: string;
          needs?: ReadonlyArray<string>;
        }>;
      }) {
          const peers = yield* SubscriptionRef.get(room.roster);
          const myName = yield* SubscriptionRef.get(nameRef);
          const keyFor = (name: string) =>
            name === myName ? identity.pubkey : peers.find((p) => p.name === name)?.key;
          const now = yield* Clock.currentTimeMillis;
          const unknown = input.steps.map((s) => s.owner).filter((o) => keyFor(o) === undefined);
          if (unknown.length > 0) {
            return yield* Effect.die(`unknown step owners: ${unknown.join(", ")} — use names from list-room`);
          }
          const id = crypto.randomUUID();
          const ticket: Ticket = {
            id,
            threadId: id,
            project: input.project,
            goal: input.goal,
            createdBy: identity.pubkey,
            updatedAt: now,
            steps: input.steps.map((s, i) => ({
              id: s.id ?? `s${i + 1}`,
              owner: keyFor(s.owner)!,
              intent: s.intent,
              description: s.description,
              needs: s.needs ?? [],
              status: "pending" as const,
              updatedAt: now,
            })),
          };
          const merged = yield* room.shareTicket(ticket);
          return toToon({ ticket: yield* renderTicket(merged) });
      }),
      "settle-step": Effect.fn("Mcp.settleStep")(function* (input: { ticketId: string; stepId: string; result: string; failed?: boolean }) {
          const all = yield* SubscriptionRef.get(room.tickets);
          const ticket = all.get(input.ticketId);
          if (!ticket) return yield* Effect.die(`no ticket ${input.ticketId} — check get-tickets`);
          if (!ticket.steps.some((s) => s.id === input.stepId)) {
            return yield* Effect.die(`no step ${input.stepId} on ticket ${input.ticketId}`);
          }
          const now = yield* Clock.currentTimeMillis;
          const updated: Ticket = {
            ...ticket,
            updatedAt: now,
            steps: ticket.steps.map((s) =>
              s.id === input.stepId
                ? { ...s, status: input.failed ? ("failed" as const) : ("settled" as const), result: input.result, updatedAt: now }
                : s,
            ),
          };
          const merged = yield* room.shareTicket(updated);
          return toToon({ ticket: yield* renderTicket(merged) });
      }),
      "drive-peer": Effect.fn("Mcp.drivePeer")(function* (input: {
        peer: string;
        action: "send-message" | "create-ticket" | "settle-step";
        project?: string;
        intent?: string;
        findings?: string;
        goal?: string;
        steps?: ReadonlyArray<{ intent: string; description: string; mine?: boolean }>;
        ticketId?: string;
        stepId?: string;
        result?: string;
      }) {
        const peers = yield* SubscriptionRef.get(room.roster);
        const target = peers.find((p) => p.name === input.peer);
        if (!target) return `failed: no peer named ${input.peer}`;
        if (!(target.ai ?? "").startsWith("mock")) {
          return `failed: ${input.peer} runs "${target.ai ?? "no ai"}", not a mock — real peers can't be driven`;
        }
        const need = (field: string, v: string | undefined): v is string => v !== undefined && v.length > 0;
        const action =
          input.action === "send-message"
            ? need("project", input.project) && need("intent", input.intent) && need("findings", input.findings)
              ? ({ kind: "send-message" as const, project: input.project, intent: input.intent, findings: input.findings })
              : null
            : input.action === "create-ticket"
              ? need("project", input.project) && need("goal", input.goal) && (input.steps?.length ?? 0) > 0
                ? ({
                    kind: "create-ticket" as const,
                    project: input.project!,
                    goal: input.goal!,
                    steps: input.steps!.map((s) => ({ intent: s.intent, description: s.description, mine: s.mine ?? false })),
                  })
                : null
              : need("ticketId", input.ticketId) && need("stepId", input.stepId) && need("result", input.result)
                ? ({ kind: "settle-step" as const, ticketId: input.ticketId, stepId: input.stepId, result: input.result })
                : null;
        if (action === null) return `failed: missing fields for action "${input.action}" — see the tool description`;
        return yield* room.sendDrive(target.key, action).pipe(
          Effect.map(() => `drive sent — ${input.peer} will ${input.action} as itself`),
          Effect.catchTag("PeerNotConnected", () => Effect.succeed("failed: peer not connected")),
        );
      }),
      "get-tickets": () =>
        SubscriptionRef.get(room.tickets).pipe(
          Effect.flatMap((m) => Effect.forEach([...m.values()], renderTicket)),
          Effect.map((tickets) => toToon({ tickets })),
          Effect.withSpan("Mcp.getTickets"),
        ),
    };
  });

export const ToolHandlers = CollagenToolkit.toLayer(
  makeHandlers.pipe(Effect.map(({ "drive-peer": _drive, ...handlers }) => handlers)),
);
export const DevToolHandlers = DevCollagenToolkit.toLayer(makeHandlers);

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

    // dev runs (pnpm dev sets COLLAGEN_DEV=1) expose the drive-peer test
    // tool; anything else serves the plain toolkit — the tool doesn't exist.
    const toolkitLayer =
      process.env.COLLAGEN_DEV === "1"
        ? McpServer.toolkit(DevCollagenToolkit).pipe(Layer.provide(DevToolHandlers))
        : McpServer.toolkit(CollagenToolkit).pipe(Layer.provide(ToolHandlers));

    const serve = (port: number) =>
      HttpRouter.serve(
        Layer.mergeAll(
          toolkitLayer,
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
