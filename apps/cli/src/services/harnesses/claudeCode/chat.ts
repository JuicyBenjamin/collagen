import { Option } from "effect";
import type { ChatAdapter, ChatEvent } from "../../ChatAdapters";
import { doingOf, json, rec, stringOf } from "../../ChatAdapters";

/** Read-only: what the chat may use in the reader's clone. */
const CLAUDE_TOOLS = ["Read", "Grep", "Glob", "Bash(git show:*)", "Bash(git log:*)", "Bash(git diff:*)", "Bash(git blame:*)"];

// Claude: stream-json with partial messages — a delta per few words. MCP
// inline and strict, as on a nudge, but only the reads: the why of the
// review (review-context) and the tickets.
export const claudeChat: ChatAdapter = {
  cmd: "claude",
  forks: true,
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
      ...(Option.isSome(context.model) ? ["--model", context.model.value] : []),
    ];
    return Option.isSome(context.sessionId) ? ["--resume", context.sessionId.value, ...(context.fork ? ["--fork-session"] : []), ...base] : base;
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

