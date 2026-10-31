import { Option } from "effect";
import type { ChatAdapter, ChatEvent } from "../../ChatAdapters";
import { doingOf, json, rec, stringOf } from "../../ChatAdapters";

// Codex: `exec --json` says each message whole once it is written; read-only
// sandbox, as on a nudge. Its MCP tools are left to ask for approval, which
// exec refuses: the chat reads the clone, never writes to the room.
export const codexChat: ChatAdapter = {
  cmd: "codex",
  args: (context) => {
    const flags = ["--json", "-c", 'sandbox_mode="read-only"', "--skip-git-repo-check", ...(Option.isSome(context.model) ? ["--model", context.model.value] : [])];
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
