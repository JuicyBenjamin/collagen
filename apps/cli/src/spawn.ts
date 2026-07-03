import { spawn } from "node:child_process";
import type { RoomMessage } from "@collagen/p2p";

export interface SpawnOpts {
  ai: string | null; // recipient's preferred AI
  cwd: string; // project path (stable per thread; resume needs same cwd)
  mcpUrl: string;
  serverName: string; // the registered MCP server name (collagen / collagen-<profile>)
  msg: RoomMessage;
  sessionId?: string; // set → continue that conversation; unset → new
  onSession?: (sessionId: string) => void;
  onLog?: (line: string) => void;
  onClose?: () => void;
}

interface Adapter {
  cmd: string;
  args: (o: SpawnOpts) => string[];
  parse: (out: string) => { sessionId?: string; result?: string };
}

function prompt(o: SpawnOpts): string {
  const verb = o.sessionId ? "a new message arrived in this conversation" : "a new conversation was started";
  return `Collagen: ${verb} from ${o.msg.fromName} about "${o.msg.project}" (intent: ${o.msg.intent}). Use the ${o.serverName} get-messages tool with threadId "${o.msg.threadId}" to read it, then act on the findings in this repo.`;
}

const ADAPTERS: Record<string, Adapter> = {
  // Claude: MCP passed inline + strict so the spawn is isolated to this cli's
  // server even if others are registered. session_id in the single JSON object.
  "claude-code": {
    cmd: "claude",
    args: (o) => {
      const mcp = JSON.stringify({ mcpServers: { [o.serverName]: { type: "http", url: o.mcpUrl } } });
      const base = [
        "-p",
        prompt(o),
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
      return o.sessionId ? ["--resume", o.sessionId, ...base] : base;
    },
    parse: (out) => {
      try {
        const j = JSON.parse(out) as { session_id?: string; result?: string };
        return { sessionId: j.session_id, result: j.result };
      } catch {
        return {};
      }
    },
  },

  // Codex: MCP comes from ~/.codex/config.toml (registered at launch). `exec` is
  // non-interactive (no approvals) by design; read-only sandbox so it can only
  // observe. --json streams events; scan for session_id.
  codex: {
    cmd: "codex",
    args: (o) => {
      const flags = ["--json", "--sandbox", "read-only", "--skip-git-repo-check"];
      return o.sessionId
        ? ["exec", "resume", o.sessionId, ...flags, prompt(o)]
        : ["exec", ...flags, prompt(o)];
    },
    parse: (out) => {
      // JSONL events: `thread.started` carries the resumable thread_id,
      // `item.completed` with an agent_message item carries the final text.
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
  },
};

/** Auto-trigger the recipient's preferred AI on an incoming message. Serialized
 *  per thread by the caller (concurrent resumes of one session corrupt it). */
export function spawnAgent(opts: SpawnOpts): void {
  const ai = opts.ai ?? "claude-code";
  const adapter = ADAPTERS[ai];
  if (!adapter) {
    opts.onLog?.(`(no spawn adapter for "${ai}" yet)`);
    opts.onClose?.();
    return;
  }
  try {
    const child = spawn(adapter.cmd, adapter.args(opts), { cwd: opts.cwd });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => opts.onLog?.(`${adapter.cmd}: ${d.toString().trim()}`));
    child.on("error", (e) => {
      opts.onLog?.(`spawn error: ${e.message}`);
      opts.onClose?.();
    });
    child.on("close", () => {
      const { sessionId, result } = adapter.parse(out);
      if (sessionId) opts.onSession?.(sessionId);
      opts.onLog?.(`agent done: ${(result ?? "").slice(0, 160)}`);
      opts.onClose?.();
    });
  } catch (e) {
    opts.onLog?.(`spawn failed: ${(e as Error).message}`);
    opts.onClose?.();
  }
}
