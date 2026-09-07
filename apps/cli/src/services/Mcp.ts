import { statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { Clock, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { encode as toToon } from "@toon-format/toon";
import { AI_OPTIONS, isRoomId, newProject, Room, roomProjects, shortRoomId, type Ticket } from "@collagen/p2p";
import { readProfileFile, upsertActiveRoom, writeProfileFile } from "../config/profileFile";
import { MOCK_AI_OPTIONS } from "./Adapters";
import { portForProfile } from "./mcpAddress";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { Scripting } from "./Scripting";
import { StateStore } from "./StateStore";
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

const RESTART_NOTE =
  "Collagen runs one room per process — it joins the active room on its next start, so ask the user to restart collagen (q, then start it again).";

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

const PendingThreads = Tool.make("pending-threads", {
  description:
    "List the conversation threads that have messages waiting for you, without consuming them. Each row is one thread: its threadId, who it's from, the project, how many messages are queued, and the latest intent. Call this first to see what's waiting, then pull a specific thread with get-messages. Returns TOON (compact YAML/CSV-style) text.",
  success: Schema.String,
});

const WatchRoom = Tool.make("watch-room", {
  description:
    "How to stay responsive to room messages WITHOUT blocking your conversation — call this once and follow the instructions for your harness. Pass which harness you are running in: 'claude-code' (you get a background-watcher recipe: events arrive while the user keeps chatting), 'codex' (adopt threads and collagen queues messages directly into your session), or 'other' (polling fallback). This tool changes nothing by itself; it returns setup instructions.",
  parameters: Schema.Struct({
    harness: Schema.Literals(["claude-code", "codex", "other"]),
  }),
  success: Schema.String,
});

const AwaitMessages = Tool.make("await-messages", {
  description:
    "Wait for the next incoming room message: this call BLOCKS until a message arrives (returning the pending threads immediately) or until `seconds` elapse (returning a keep-waiting note). This is how you watch the room from any harness — while you have nothing else to do, call await-messages in a loop: handle what it returns (get-messages → act → send-to-peer), then call it again. Waiting costs nothing. Default 55 seconds; raise it only if your harness allows longer tool calls, lower it if it times out.",
  parameters: Schema.Struct({
    seconds: Schema.optional(Schema.Finite),
  }),
  success: Schema.String,
});

const AdoptThread = Tool.make("adopt-thread", {
  description:
    "Link a collagen thread to YOUR OWN conversation in your agent harness, so new messages on it resume that conversation (claude --resume / codex exec resume) instead of waiting in the inbox — the full loop with no manual pulling. 'threadId' is collagen's thread id (from pending-threads or a message you were handed) — it is derived by collagen and can never be chosen or changed. 'sessionId' is the id of your conversation IN THE HARNESS: the Claude Code session id, or the codex thread id. This only stores a mapping; it does not alter any collagen ids. Adoption persists across restarts. Adopt only your own conversation.",
  parameters: Schema.Struct({
    threadId: Schema.String,
    agent: Schema.Literals(["claude-code", "codex"]),
    sessionId: Schema.String,
  }),
  success: Schema.String,
});

const GetMessages = Tool.make("get-messages", {
  description:
    "Retrieve and clear the messages waiting in one thread. You must pass the threadId of the thread you're pulling (get it from pending-threads, or from a message you were already handed). Each message includes the sender, project, intent, and findings — use them to pick up the conversation and act on the request. To reply, use send-to-peer with the same peer and project (that keeps the reply in this thread).",
  parameters: Schema.Struct({
    threadId: Schema.String,
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
    "Create a shared ticket: a structured, serialized record of a cross-peer task. Steps name an owner (a peer name from list-room, or yourself), an intent verb, a full description, and optional 'needs' (ids of steps that must settle first). The ticket is broadcast to the room; each owner's agent is triggered when its steps become actionable, and settles them with settle-step. Prefer this over send-to-peer for multi-step work — the intermediate state stays inspectable and survives restarts.",
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
    "Settle (or fail) a ticket step you own, with your findings as the result. The updated ticket is broadcast to the room; steps waiting on this one become actionable on their owners' side.",
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

// ── settings on behalf of the user ──────────────────────────────────────────
// Anything a person can configure, an agent can configure for them. UI state
// (tabs, focus) is deliberately NOT here.

const AddProject = Tool.make("add-project", {
  description:
    "Share a local project folder into the CURRENT room on behalf of the user. 'path' must be an existing directory (absolute, or relative to the agent's cwd); 'name' defaults to the folder name. Applies live — peers see it at once and can message about it.",
  parameters: Schema.Struct({ path: Schema.String, name: Schema.optional(Schema.String) }),
  success: Schema.String,
});

const RemoveProject = Tool.make("remove-project", {
  description: "Stop sharing one of the user's projects in the current room, by name. Applies live.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

const SetAi = Tool.make("set-ai", {
  description:
    "Set which agent CLI acts for this user: 'claude-code', 'codex', a mock ('mock:claude-code' / 'mock:codex' — test dummies, visibly labeled to peers), or 'none' (inbox mode: nothing ever auto-runs; messages wait to be pulled). Applies live; peers see the choice and its auth status.",
  parameters: Schema.Struct({ ai: Schema.Literals([...AI_OPTIONS, ...MOCK_AI_OPTIONS, "none"]) }),
  success: Schema.String,
});

const SetName = Tool.make("set-name", {
  description: "Change the user's display name as peers see it. Applies live.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

const RenameRoom = Tool.make("rename-room", {
  description: "Rename the CURRENT room for everyone in it (the name is shared state, broadcast last-writer-wins). Applies live.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

const ListRooms = Tool.make("list-rooms", {
  description:
    "Every room this user has created or joined, with the stable short id, the name, which one is active, and the invite id (the secret a friend needs to join — share it only when the user asks). Returns TOON text.",
  success: Schema.String,
});

const CreateRoom = Tool.make("create-room", {
  description:
    "Create a new room for the user and make it their active room. Collagen runs one room per process, so it JOINS the new room on the next start — tell the user to restart collagen (q, then start it again). Returns the invite id to share with friends.",
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.String,
});

const JoinRoom = Tool.make("join-room", {
  description:
    "Join a friend's room from its invite id (a uuid the friend copied with c) and make it the active room. Takes effect on the next start — tell the user to restart collagen. Optional 'name' is a local label until the room's shared name arrives.",
  parameters: Schema.Struct({ inviteId: Schema.String, name: Schema.optional(Schema.String) }),
  success: Schema.String,
});

const SwitchRoom = Tool.make("switch-room", {
  description:
    "Make one of the user's known rooms active (by short id, name, or invite id — see list-rooms). Takes effect on the next start — tell the user to restart collagen.",
  parameters: Schema.Struct({ room: Schema.String }),
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
  PendingThreads,
  GetMessages,
  AwaitMessages,
  AdoptThread,
  WatchRoom,
  ExecuteScript,
  SearchTools,
  DescribeScripting,
  CreateTicket,
  SettleStep,
  GetTickets,
  AddProject,
  RemoveProject,
  SetAi,
  SetName,
  RenameRoom,
  ListRooms,
  CreateRoom,
  JoinRoom,
  SwitchRoom,
);

/** Dev-only surface: everything plus the drive-peer test tool. A prod run
 *  never registers it — the tool doesn't exist there, it isn't just refused. */
export const DevCollagenToolkit = Toolkit.make(
  ListRoom,
  SendToPeer,
  PendingThreads,
  GetMessages,
  AwaitMessages,
  AdoptThread,
  WatchRoom,
  ExecuteScript,
  SearchTools,
  DescribeScripting,
  CreateTicket,
  SettleStep,
  GetTickets,
  AddProject,
  RemoveProject,
  SetAi,
  SetName,
  RenameRoom,
  ListRooms,
  CreateRoom,
  JoinRoom,
  SwitchRoom,
  DrivePeer,
);

const makeHandlers = Effect.gen(function* () {
    const room = yield* Room;
    const store = yield* StateStore;
    const mcpInfo = yield* McpInfo;
    const { profile } = yield* CliArgs;
    const inbox = yield* Inbox;
    const scripting = yield* Scripting;
    const { identity, room: roomInfo, knownRooms, nameRef, setName } = yield* IdentityService;
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
      "pending-threads": () =>
        inbox.pending.pipe(
          Effect.map((threads) => toToon({ threads })),
          Effect.withSpan("Mcp.pendingThreads"),
        ),
      "watch-room": ({ harness }: { harness: "claude-code" | "codex" | "other" }) =>
        Effect.gen(function* () {
          const url = yield* mcpInfo.awaitUrl;
          const origin = url.replace(/\/mcp$/, "");
          if (harness === "codex") {
            return [
              "You are on codex — collagen can push messages straight into your session:",
              "1. Note your own codex thread id (the thread_id of this conversation).",
              `2. For each collagen thread you care about, call adopt-thread {threadId, agent: "codex", sessionId: <your codex thread id>}.`,
              "3. Done. New messages on adopted threads are queued into your codex session (codex queue) — they appear at your next turn, no blocking, and your user keeps chatting normally.",
              "For not-yet-adopted threads, check pending-threads when convenient.",
            ].join("\n");
          }
          if (harness === "claude-code") {
            return [
              "You are on Claude Code — arm a persistent background monitor (Monitor tool, or a background bash task). Each output line = one new-message event arriving in this conversation while the user keeps chatting. Script:",
              "",
              "while true; do",
              `  out=$(curl -s -m 70 "${origin}/inbox/wait?seconds=60" || true)`,
              '  [ -n "$out" ] && printf \'%s\\n\' "$out"',
              "  sleep 1",
              "done",
              "",
              "On each event: get-messages with the threadId in the event line, act, reply with send-to-peer.",
              "Optionally also adopt-thread (agent claude-code, your session id) so messages reach you even when this session is closed.",
            ].join("\n");
          }
          return [
            "No push mechanism known for your harness. Options:",
            `- Poll GET ${origin}/inbox/pending (one line per waiting thread) or the pending-threads tool when convenient.`,
            "- await-messages blocks until a message arrives — fine for dedicated watcher loops, not for interactive sessions.",
            "- adopt-thread works if your agent CLI is claude-code or codex.",
          ].join("\n");
        }).pipe(Effect.withSpan("Mcp.watchRoom")),
      "await-messages": ({ seconds }: { seconds?: number }) =>
        Effect.gen(function* () {
          const waitMs = Math.min(Math.max(seconds ?? 55, 5), 570) * 1000;
          const started = yield* Clock.currentTimeMillis;
          while (true) {
            const threads = yield* inbox.pending;
            if (threads.length > 0) {
              return toToon({
                threads,
                next: "pull a thread with get-messages, act on it, reply with send-to-peer, then call await-messages again",
              });
            }
            const now = yield* Clock.currentTimeMillis;
            if (now - started >= waitMs) {
              return "no new messages — call await-messages again to keep watching the room";
            }
            yield* Effect.sleep("500 millis");
          }
        }).pipe(Effect.withSpan("Mcp.awaitMessages")),
      "adopt-thread": ({ threadId, agent, sessionId }: { threadId: string; agent: "claude-code" | "codex"; sessionId: string }) =>
        store
          .update((s) => ({ ...s, threads: { ...(s.threads ?? {}), [threadId]: { ai: agent, sessionId } } }))
          .pipe(
            Effect.map(
              () => `adopted: new messages on thread ${threadId} will resume your ${agent} conversation (${sessionId})`,
            ),
            Effect.withSpan("Mcp.adoptThread"),
          ),
      "get-messages": ({ threadId }: { threadId: string }) =>
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
      // ── settings ──
      "add-project": ({ path, name }: { path: string; name?: string }) =>
        Effect.gen(function* () {
          const abs = resolve(path);
          const isDir = yield* Effect.sync(() => {
            try {
              return statSync(abs).isDirectory();
            } catch {
              return false;
            }
          });
          if (!isDir) return `failed: ${abs} is not an existing directory`;
          const label = (name ?? basename(abs)).trim();
          if (label.length === 0) return "failed: empty project name";
          let outcome = "";
          yield* store.update((s) => {
            const here = s.rooms[roomInfo.id] ?? [];
            if (here.some((p) => p.path === abs)) {
              outcome = `already sharing ${abs}`;
              return s;
            }
            if (here.some((p) => p.name === label)) {
              outcome = `failed: a project named "${label}" is already shared in this room — pass a different name`;
              return s;
            }
            outcome = `sharing "${label}" (${abs}) in room ${roomInfo.name} — peers see it now`;
            return { ...s, rooms: { ...s.rooms, [roomInfo.id]: [...here, newProject(label, abs)] } };
          });
          return outcome;
        }).pipe(Effect.withSpan("Mcp.addProject")),
      "remove-project": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const before = roomProjects(yield* store.get, roomInfo.id);
          if (!before.some((p) => p.name === name)) {
            return `failed: no project named "${name}" in this room (yours: ${before.map((p) => p.name).join(", ") || "none"})`;
          }
          yield* store.update((s) => ({
            ...s,
            rooms: { ...s.rooms, [roomInfo.id]: (s.rooms[roomInfo.id] ?? []).filter((p) => p.name !== name) },
          }));
          return `stopped sharing "${name}"`;
        }).pipe(Effect.withSpan("Mcp.removeProject")),
      "set-ai": ({ ai }: { ai: string }) =>
        store
          .update((s) => ({ ...s, preferredAi: ai === "none" ? null : ai }))
          .pipe(
            Effect.map(() =>
              ai === "none"
                ? "ai set to none — inbox mode: nothing auto-runs, messages wait to be pulled"
                : `ai set to ${ai} — its auth status is probed now and broadcast to the room`,
            ),
            Effect.withSpan("Mcp.setAi"),
          ),
      "set-name": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const n = name.trim();
          if (n.length === 0) return "failed: empty name";
          yield* Effect.sync(() => writeProfileFile(profile, { name: n }));
          yield* setName(n);
          return `display name is now "${n}" — peers see it on the next profile broadcast`;
        }).pipe(Effect.withSpan("Mcp.setName")),
      "rename-room": ({ name }: { name: string }) =>
        Effect.gen(function* () {
          const n = name.trim();
          if (n.length === 0) return "failed: empty room name";
          yield* room.rename(n);
          return `room renamed to "${n}" for everyone in it`;
        }).pipe(Effect.withSpan("Mcp.renameRoom")),
      "list-rooms": () =>
        Effect.sync(() => {
          const f = readProfileFile(profile);
          return toToon({
            rooms: (f.rooms ?? []).map((r) => ({
              shortId: shortRoomId(r.id),
              name: r.name,
              active: r.id === (f.activeRoomId ?? roomInfo.id),
              current: r.id === roomInfo.id,
              inviteId: r.id,
            })),
          });
        }).pipe(Effect.withSpan("Mcp.listRooms")),
      "create-room": ({ name }: { name: string }) =>
        Effect.sync(() => {
          const n = name.trim();
          if (n.length === 0) return "failed: empty room name";
          const id = uuidv7();
          upsertActiveRoom(profile, { id, name: n, nameTs: Date.now() });
          return `created room "${n}" [${shortRoomId(id)}] and made it active. ${RESTART_NOTE} Invite id to share: ${id}`;
        }).pipe(Effect.withSpan("Mcp.createRoom")),
      "join-room": ({ inviteId, name }: { inviteId: string; name?: string }) =>
        Effect.sync(() => {
          const id = inviteId.trim();
          if (!isRoomId(id)) return "failed: that is not a room invite id (expected a uuid)";
          upsertActiveRoom(profile, { id, name: name?.trim() || id.slice(0, 8) });
          return `joined room [${shortRoomId(id)}] and made it active. ${RESTART_NOTE}`;
        }).pipe(Effect.withSpan("Mcp.joinRoom")),
      "switch-room": ({ room: which }: { room: string }) =>
        Effect.sync(() => {
          const f = readProfileFile(profile);
          const q = which.trim();
          const hit = (f.rooms ?? []).find((r) => r.id === q || shortRoomId(r.id) === q || r.name === q);
          if (!hit) return `failed: no known room matching "${q}" — see list-rooms`;
          const alreadyActive = (f.activeRoomId ?? roomInfo.id) === hit.id;
          if (hit.id === roomInfo.id && alreadyActive) return `already in "${hit.name}" and it is the active room`;
          upsertActiveRoom(profile, hit);
          // switching back to the room we're currently in just cancels a
          // pending create/join — no restart needed for that
          return hit.id === roomInfo.id
            ? `"${hit.name}" is the active room again (a pending switch was cancelled) — no restart needed`
            : `active room is now "${hit.name}" [${shortRoomId(hit.id)}]. ${RESTART_NOTE}`;
        }).pipe(Effect.withSpan("Mcp.switchRoom")),
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
/** Plain-HTTP inbox endpoints beside /mcp, so a watcher script needs no MCP
 *  handshake: GET /inbox/pending lists waiting threads (one line each);
 *  GET /inbox/wait?seconds=N long-polls until something is waiting (204 on
 *  timeout). Read-only — messages are only consumed via get-messages. */
const inboxLine = (t: { threadId: string; from: string; project: string; count: number; lastIntent: string }) =>
  `${t.threadId} | ${t.from} | ${t.project} | ${t.count} msg | ${t.lastIntent}`;

const InboxRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/inbox/pending",
    Effect.gen(function* () {
      const threads = yield* (yield* Inbox).pending;
      return HttpServerResponse.text(threads.map(inboxLine).join("\n"));
    }),
  ),
  HttpRouter.add("GET", "/inbox/wait", (request) =>
    Effect.gen(function* () {
      const seconds = Number(new URL(request.url, "http://localhost").searchParams.get("seconds") ?? "60");
      const waitMs = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 60, 1), 300) * 1000;
      const inbox = yield* Inbox;
      const started = yield* Clock.currentTimeMillis;
      while (true) {
        const threads = yield* inbox.pending;
        if (threads.length > 0) return HttpServerResponse.text(threads.map(inboxLine).join("\n"));
        const now = yield* Clock.currentTimeMillis;
        if (now - started >= waitMs) return HttpServerResponse.empty({ status: 204 });
        yield* Effect.sleep("500 millis");
      }
    }),
  ),
);

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
          InboxRoutes,
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

    const port = portForProfile(profile);
    // Say WHY we fell back — a silent ephemeral port makes every registered
    // client point at the wrong place with no trace.
    return serve(port).pipe(
      Layer.catch((e) =>
        Layer.unwrap(
          Effect.logWarning(`mcp port ${port} unavailable (${String(e).slice(0, 120)}) — using an ephemeral port`).pipe(
            Effect.as(serve(0)),
          ),
        ),
      ),
    );
  }),
);
