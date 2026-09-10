import { existsSync } from "node:fs";
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
  // Human in the loop. The nudge carries only the headline; the details stay
  // in collagen until the person asks. The agent relays, never decides: what
  // it can't find in the thread is either its own user's to answer (from this
  // repo, under direction) or the other peer's (then it drafts the question).
  const ticketNote = o.msg.ticketId ? ` (about ticket ${o.msg.ticketId.slice(0, 8)}; get-tickets has it)` : "";
  const headline = o.msg.intent.startsWith("ticket-update:")
    ? `Collagen: ${o.msg.fromName} ${o.msg.intent.slice("ticket-update:".length)} on a ticket your user is part of, project "${o.msg.project}"${ticketNote}.`
    : `Collagen: ${verb} — ${o.msg.fromName} asks your user to address "${o.msg.intent}" on project "${o.msg.project}"${ticketNote}.`;
  return [
    headline,
    `Tell your user exactly that, in one line, and wait. Do not read the details yet, do not investigate, decide or answer anything: a person decides here.`,
    `If your user asks what it says or wants more, read it with the ${o.serverName} get-messages tool, threadId "${o.msg.threadId}" (a ticket's steps: get-tickets), and relay what is there — never fill gaps from your own head.`,
    `If your user then asks something the thread does not answer, decide which it is: yours to answer from this repo under their direction, or ${o.msg.fromName}'s to answer — then draft that question for them with send-to-peer.`,
    `Anything you send is only what your user decided — it goes to the room as soon as you send it, and the collagen TUI's outbox shows them what went.`,
  ].join(" ");
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
// Next to the built entry (dist/) or in src/dev when running from source.
const mockAgentPath = [new URL("./mock-agent.mjs", import.meta.url), new URL("../dev/mock-agent.mjs", import.meta.url)]
  .map((u) => fileURLToPath(u))
  .find((p) => existsSync(p)) ?? fileURLToPath(new URL("../dev/mock-agent.mjs", import.meta.url));

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
    // the stored session id doubles as the mock's memory: it encodes how many
    // acks this thread got ("mock#N"), so the cap survives across spawns
    Option.getOrElse(o.sessionId, () => "fresh"),
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
