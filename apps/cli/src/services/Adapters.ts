import { fileURLToPath } from "node:url";
import { Context, Layer, Option } from "effect";
import type { RoomMessage } from "@collagen/p2p";

export interface SpawnCtx {
  cwd: string;
  mcpUrl: string;
  serverName: string;
  msg: RoomMessage;
  sessionId: Option.Option<string>;
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
}

export function nudgePrompt(o: SpawnCtx): string {
  const verb = Option.isSome(o.sessionId)
    ? "a new message arrived in this conversation"
    : "a new conversation was started";
  return `Collagen: ${verb} from ${o.msg.fromName} about "${o.msg.project}" (intent: ${o.msg.intent}). Use the ${o.serverName} get-messages tool with threadId "${o.msg.threadId}" to read it, then act on the findings in this repo.`;
}

// Claude: MCP passed inline + strict so the spawn is isolated to this cli's
// server even if others are registered. session_id in the single JSON object.
export const claudeAdapter: Adapter = {
  cmd: "claude",
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
  args: (o) => {
    const mcp = JSON.stringify({ mcpServers: { [o.serverName]: { type: "http", url: o.mcpUrl } } });
    const base = [
      "-p",
      nudgePrompt(o),
      "--mcp-config",
      mcp,
      "--strict-mcp-config",
      "--allowedTools",
      `mcp__${o.serverName}__*,Read,Grep,Glob`,
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "json",
    ];
    return Option.isSome(o.sessionId) ? ["--resume", o.sessionId.value, ...base] : base;
  },
  parse: (out) => {
    try {
      const j = JSON.parse(out) as { session_id?: string; result?: string };
      return { sessionId: j.session_id, result: j.result };
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
  auth: {
    args: ["login", "status"],
    loggedIn: (out, exitCode) => exitCode === 0 && !/not logged in/i.test(out),
  },
  args: (o) => {
    const flags = [
      "--json",
      // -c form, not --sandbox: `exec resume` (codex ≥0.152) has no --sandbox
      // flag, but both subcommands accept the config override.
      "-c",
      'sandbox_mode="read-only"',
      "--skip-git-repo-check",
      // pre-trust our MCP tools — exec mode auto-cancels approval prompts
      "-c",
      `mcp_servers.${o.serverName}.default_tools_approval_mode="approve"`,
    ];
    return Option.isSome(o.sessionId)
      ? ["exec", "resume", o.sessionId.value, ...flags, nudgePrompt(o)]
      : ["exec", ...flags, nudgePrompt(o)];
  },
  parse: (out) => {
    let sessionId: string | undefined;
    let result: string | undefined;
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as {
          type?: string;
          thread_id?: string;
          item?: { type?: string; text?: string };
        };
        if (ev.type === "thread.started" && ev.thread_id) sessionId = ev.thread_id;
        if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) {
          result = ev.item.text;
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
const mockAgentPath = fileURLToPath(new URL("../mock-agent.mjs", import.meta.url));

export const mockAdapter: Adapter = {
  cmd: process.execPath,
  auth: {
    args: ["--version"],
    loggedIn: (_out, exitCode) => exitCode === 0,
  },
  args: (o) => [
    mockAgentPath,
    o.mcpUrl,
    o.msg.threadId,
    o.msg.fromName,
    o.msg.project,
    o.msg.intent,
    Option.isSome(o.sessionId) ? "resumed" : "fresh",
  ],
  parse: (out) => {
    try {
      const j = JSON.parse(out) as { session_id?: string; result?: string };
      return { sessionId: j.session_id, result: j.result };
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
