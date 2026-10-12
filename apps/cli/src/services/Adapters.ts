import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Context, Layer, Option } from "effect";
import type { RoomMessage, Steering } from "@collagen/p2p";
import { steeringLine } from "../lib/steering";
import { actedBy } from "../lib/agents";
import { claudeChat, codexChat, mockChat, type ChatAdapter } from "./ChatAdapters";

export interface SpawnCtx {
  cwd: string;
  mcpUrl: string;
  serverName: string;
  message: RoomMessage;
  sessionId: Option.Option<string>;
  /** the person's steering level (lib/steering); absent = ask */
  steering?: Steering;
}

export interface Adapter {
  cmd: string;
  args: (o: SpawnCtx) => string[];
  parse: (out: string) => { sessionId?: string; result?: string };
  /** Cheap auth probe: command + how to read "logged in" from its output. */
  auth: {
    args: string[];
    /** exitCode/out from running `cmd auth.args` */
    loggedIn: (out: string, exitCode: number) => boolean;
  };
  /** asked about code on the review page, its answer streamed there (ReviewChat) — absent: it cannot be */
  chat?: ChatAdapter;
}

export function nudgePrompt(spawnContext: SpawnCtx): string {
  const verb = Option.isSome(spawnContext.sessionId)
    ? "a new message arrived in this conversation"
    : "a new conversation was started";
  // Human in the loop. The nudge carries only the headline; the details stay
  // in collagen until the person asks. The agent relays, never decides: what
  // it can't find in the thread is either its own user's to answer (from this
  // repo, under direction) or the other peer's (then it drafts the question).
  const ticketNote = spawnContext.message.ticketId ? ` (ticket ${spawnContext.message.ticketId}; get-ticket shows it)` : "";
  const headline = spawnContext.message.intent.startsWith("ticket-update:")
    ? `Collagen: ${actedBy(spawnContext.message.fromName, spawnContext.message.agent)} ${spawnContext.message.intent.slice("ticket-update:".length)} on a ticket your user is part of, project "${spawnContext.message.project}"${ticketNote}.`
    : `Collagen: ${verb} — ${actedBy(spawnContext.message.fromName, spawnContext.message.agent)} asks your user to address "${spawnContext.message.intent}" on project "${spawnContext.message.project}"${ticketNote}.`;
  const level = spawnContext.steering ?? "ask";
  return [
    headline,
    level === "ask"
      ? `Tell your user exactly that, in one line, and wait. Do not read the details yet, do not investigate, decide or answer anything: a person decides here.`
      : `Tell your user exactly that, in one line. ${steeringLine(level)}`,
    `If your user asks what it says or wants more, read it with the ${spawnContext.serverName} get-messages tool, threadId "${spawnContext.message.threadId}" (a ticket's steps: get-ticket), and relay what is there — never fill gaps from your own head.`,
    `If your user then asks something the thread does not answer, decide which it is: yours to answer from this repo under their direction, or ${spawnContext.message.fromName}'s to answer — then draft that question for them with send-to-peer.`,
    `Anything you send is only what your user decided — it goes to the room as soon as you send it, and the collagen TUI's outbox shows them what went.`,
  ].join(" ");
}

// Claude: MCP passed inline + strict so the spawn is isolated to this cli's
// server even if others are registered. session_id in the single JSON object.
export const claudeAdapter: Adapter = {
  cmd: "claude",
  chat: claudeChat,
  auth: {
    args: ["auth", "status"],
    loggedIn: (out) => {
      try {
        return (JSON.parse(out) as { loggedIn?: boolean }).loggedIn === true;
      } catch {
        return false;
      }
    },
  },
  args: (spawnContext) => {
    const mcp = JSON.stringify({ mcpServers: { [spawnContext.serverName]: { type: "http", url: spawnContext.mcpUrl } } });
    const base = [
      "-p",
      nudgePrompt(spawnContext),
      "--mcp-config",
      mcp,
      "--strict-mcp-config",
      "--allowedTools",
      `mcp__${spawnContext.serverName}__*,Read,Grep,Glob`,
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "json",
    ];
    return Option.isSome(spawnContext.sessionId) ? ["--resume", spawnContext.sessionId.value, ...base] : base;
  },
  parse: (out) => {
    try {
      const output = JSON.parse(out) as { session_id?: string; result?: string };
      return { sessionId: output.session_id, result: output.result };
    } catch {
      return {};
    }
  },
};

// Codex: MCP comes from ~/.codex/config.toml (registered at launch). `exec` is
// non-interactive (no approvals) by design; read-only sandbox so it can only
// observe. --json streams events; scan for the resumable thread_id.
export const codexAdapter: Adapter = {
  cmd: "codex",
  chat: codexChat,
  auth: {
    args: ["login", "status"],
    loggedIn: (out, exitCode) => exitCode === 0 && !/not logged in/i.test(out),
  },
  args: (spawnContext) => {
    const flags = [
      "--json",
      // -c form, not --sandbox: `exec resume` (codex ≥0.152) has no --sandbox
      // flag, but both subcommands accept the config override.
      "-c",
      'sandbox_mode="read-only"',
      "--skip-git-repo-check",
      // pre-trust our MCP tools — exec mode auto-cancels approval prompts
      "-c",
      `mcp_servers.${spawnContext.serverName}.default_tools_approval_mode="approve"`,
    ];
    return Option.isSome(spawnContext.sessionId)
      ? ["exec", "resume", spawnContext.sessionId.value, ...flags, nudgePrompt(spawnContext)]
      : ["exec", ...flags, nudgePrompt(spawnContext)];
  },
  parse: (out) => {
    let sessionId: string | undefined;
    let result: string | undefined;
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          thread_id?: string;
          item?: { type?: string; text?: string };
        };
        if (event.type === "thread.started" && event.thread_id) sessionId = event.thread_id;
        if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
          result = event.item.text;
        }
      } catch {
        // non-JSON line
      }
    }
    return { sessionId, result };
  },
};

// Mock: a real spawn of a tiny node script that does the full agent dance
// (MCP handshake → get-messages → send-to-peer ack) with canned "thinking".
// Lets a machine without any LLM CLI be a complete peer in a cross-network
// test — everything downstream of the adapter (AgentRunner, MCP, swarm) is
// exercised for real.
// Next to the built entry (dist/) or in src/dev when running from source.
const mockAgentPath = [new URL("./mock-agent.mjs", import.meta.url), new URL("../dev/mock-agent.mjs", import.meta.url)]
  .map((url) => fileURLToPath(url))
  .find((candidate) => existsSync(candidate)) ?? fileURLToPath(new URL("../dev/mock-agent.mjs", import.meta.url));

export const mockAdapter: Adapter = {
  cmd: process.execPath,
  chat: mockChat,
  auth: {
    args: ["--version"],
    loggedIn: (_out, exitCode) => exitCode === 0,
  },
  args: (spawnContext) => [
    mockAgentPath,
    spawnContext.mcpUrl,
    spawnContext.message.threadId,
    spawnContext.message.fromName,
    spawnContext.message.project,
    spawnContext.message.intent,
    // the stored session id doubles as the mock's memory: it encodes how many
    // acks this thread got ("mock#N"), so the cap survives across spawns
    Option.getOrElse(spawnContext.sessionId, () => "fresh"),
  ],
  parse: (out) => {
    try {
      const output = JSON.parse(out) as { session_id?: string; result?: string };
      return { sessionId: output.session_id, result: output.result };
    } catch {
      return {};
    }
  },
};

/** Injectable spawn-adapter registry, keyed by the `preferredAi` value.
 *  Tests provide fakes here instead of spawning real agent CLIs. */
export class Adapters extends Context.Service<Adapters, Readonly<Record<string, Adapter>>>()("cli/Adapters") {}

export const AdaptersLive = Layer.succeed(Adapters, {
  "claude-code": claudeAdapter,
  codex: codexAdapter,
  "mock:claude-code": mockAdapter,
  "mock:codex": mockAdapter,
});

/** The mocked options in the ai cycle. Two names, one behavior — the point
 *  is the label: peers see "mock:claude-code" in the room and know no real
 *  AI sits behind this peer. Always available, so a machine without any LLM
 *  subscription can be a full peer out of the box. */
export const MOCK_AI_OPTIONS = ["mock:claude-code", "mock:codex"] as const;
