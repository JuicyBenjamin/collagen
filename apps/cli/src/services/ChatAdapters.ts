import { Option } from "effect";

// The reader's own AI, asked about the code on the review page (ReviewChat):
// the same CLI they run, in their clone, read-only — its answer read off its
// stdout line by line as it writes it, so the page shows it growing. One
// reader per CLI: each says, in its own event format, the conversation's id
// (to resume it for the next question), text as it comes, what it is doing
// between (a file read, a command), its final answer, or why it failed.

export interface ChatCtx {
  readonly cwd: string;
  readonly prompt: string;
  /** the conversation to go on with — none: a new one */
  readonly sessionId: Option.Option<string>;
  readonly mcpUrl: string;
  readonly serverName: string;
}

export type ChatEvent =
  | { readonly kind: "session"; readonly id: string }
  /** text as it is written; `block`: it starts a new paragraph of the answer */
  | { readonly kind: "text"; readonly text: string; readonly block: boolean }
  | { readonly kind: "doing"; readonly what: string }
  /** the whole answer, as the CLI gives it at the end — it replaces what streamed */
  | { readonly kind: "final"; readonly text: string }
  | { readonly kind: "failed"; readonly error: string };

export interface ChatAdapter {
  readonly cmd: string;
  readonly args: (o: ChatCtx) => ReadonlyArray<string>;
  /** one line of the CLI's stdout, as events — none for a line that says nothing to the page */
  readonly read: (line: string) => ReadonlyArray<ChatEvent>;
}

const json = (line: string): Record<string, unknown> | null => {
  if (!line.trim().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const rec = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

/** A tool call in a word or two and its target: "Read src/a.ts", "git show …". */
const doingOf = (name: string, input: Record<string, unknown>): string => {
  const target = stringOf(input["file_path"]) ?? stringOf(input["path"]) ?? stringOf(input["pattern"]) ?? stringOf(input["command"]) ?? "";
  const short = name.replace(/^mcp__.*?__/, "");
  return `${short} ${target}`.trim().slice(0, 160);
};

/** Read-only: what the chat may use in the reader's clone. */
const CLAUDE_TOOLS = ["Read", "Grep", "Glob", "Bash(git show:*)", "Bash(git log:*)", "Bash(git diff:*)", "Bash(git blame:*)"];

// Claude: stream-json with partial messages — a delta per few words. MCP
// inline and strict, as on a nudge, but only the reads: the why of the
// review (review-context) and the tickets.
export const claudeChat: ChatAdapter = {
  cmd: "claude",
  args: (context) => {
    const mcp = JSON.stringify({ mcpServers: { [context.serverName]: { type: "http", url: context.mcpUrl } } });
    const base = [
      "-p",
      context.prompt,
      "--mcp-config",
      mcp,
      "--strict-mcp-config",
      "--allowedTools",
      [...CLAUDE_TOOLS, `mcp__${context.serverName}__review-context`, `mcp__${context.serverName}__get-tickets`].join(","),
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    return Option.isSome(context.sessionId) ? ["--resume", context.sessionId.value, ...base] : base;
  },
  read: (line) => {
    const record = json(line);
    if (!record) return [];
    const type = stringOf(record["type"]);
    if (type === "system" && stringOf(record["subtype"]) === "init" && stringOf(record["session_id"])) return [{ kind: "session", id: stringOf(record["session_id"])! }];
    if (type === "stream_event") {
      const event = rec(record["event"]);
      if (event["type"] === "content_block_start" && rec(event["content_block"])["type"] === "text") return [{ kind: "text", text: stringOf(rec(event["content_block"])["text"]) ?? "", block: true }];
      if (event["type"] === "content_block_delta" && rec(event["delta"])["type"] === "text_delta") return [{ kind: "text", text: stringOf(rec(event["delta"])["text"]) ?? "", block: false }];
      return [];
    }
    if (type === "assistant") {
      const content = rec(record["message"])["content"];
      return (Array.isArray(content) ? content : [])
        .map(rec)
        .filter((block) => block["type"] === "tool_use")
        .map((block): ChatEvent => ({ kind: "doing", what: doingOf(stringOf(block["name"]) ?? "tool", rec(block["input"])) }));
    }
    if (type === "result") {
      const out: Array<ChatEvent> = [];
      const sid = stringOf(record["session_id"]);
      if (sid) out.push({ kind: "session", id: sid });
      const result = stringOf(record["result"]);
      if (record["is_error"] === true || (stringOf(record["subtype"]) ?? "success") !== "success") out.push({ kind: "failed", error: result || stringOf(record["subtype"]) || "it stopped" });
      else if (result !== undefined) out.push({ kind: "final", text: result });
      return out;
    }
    return [];
  },
};

// Codex: `exec --json` says each message whole once it is written; read-only
// sandbox, as on a nudge. Its MCP tools are left to ask for approval, which
// exec refuses: the chat reads the clone, never writes to the room.
export const codexChat: ChatAdapter = {
  cmd: "codex",
  args: (context) => {
    const flags = ["--json", "-c", 'sandbox_mode="read-only"', "--skip-git-repo-check"];
    return Option.isSome(context.sessionId) ? ["exec", "resume", context.sessionId.value, ...flags, context.prompt] : ["exec", ...flags, context.prompt];
  },
  read: (line) => {
    const record = json(line);
    if (!record) return [];
    const type = stringOf(record["type"]);
    const item = rec(record["item"]);
    if (type === "thread.started" && stringOf(record["thread_id"])) return [{ kind: "session", id: stringOf(record["thread_id"])! }];
    if (type === "item.started" && item["type"] === "command_execution") return [{ kind: "doing", what: (stringOf(item["command"]) ?? "").slice(0, 160) }];
    if (type === "item.completed" && item["type"] === "agent_message" && stringOf(item["text"])) return [{ kind: "text", text: stringOf(item["text"])!, block: true }];
    if (type === "turn.failed") return [{ kind: "failed", error: stringOf(rec(record["error"])["message"]) ?? "it stopped" }];
    if (type === "error") return [{ kind: "failed", error: stringOf(record["message"]) ?? "it stopped" }];
    return [];
  },
};

// Mock: no model — a few words back in Claude's own format, a little at a
// time, so the page's streaming is exercised by a machine with no AI.
const MOCK_SCRIPT = `
const q = (process.argv[1] || "").split("\\n").filter((l) => l.startsWith("Their question: ")).pop() || "";
const words = ("Mock answer: " + q.slice("Their question: ".length)).split(" ");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const sid = process.argv[2] === "fresh" ? "mock-chat-" + process.pid : process.argv[2];
out({ type: "system", subtype: "init", session_id: sid });
out({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "text", text: "" } } });
let i = 0;
const tick = () => {
  if (i < words.length) {
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: (i ? " " : "") + words[i++] } } });
    setTimeout(tick, 40);
  } else out({ type: "result", subtype: "success", is_error: false, result: words.join(" "), session_id: sid });
};
tick();
`;

export const mockChat: ChatAdapter = {
  cmd: process.execPath,
  args: (context) => ["-e", MOCK_SCRIPT, context.prompt, Option.getOrElse(context.sessionId, () => "fresh")],
  read: claudeChat.read,
};
