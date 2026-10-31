import { asCount, asObject, asText, collagenTool, lines, Reader, resultText, sessionCost, TOO_LONG, type SessionCost } from "../../../lib/tokenCost";

// What collagen costs Claude Code, from its own session logs.

/** A Claude Code session (`<claude>/projects/<slug>/<session>.jsonl`). A reply
 *  spans several lines that repeat its usage, so usage counts once per
 *  message id. Compactions are `compact_boundary` system lines. */
export function readUsage(jsonl: string, file = ""): SessionCost {
  const reader = new Reader();
  const seen = new Set<string>();
  for (const line of lines(jsonl)) {
    const at = typeof line.timestamp === "string" ? line.timestamp : null;
    // its name: the title it was given (the latest), else its first prompt
    if (line.type === "custom-title" && typeof line.customTitle === "string" && line.customTitle.trim()) reader.title = line.customTitle.trim();
    if (line.type === "last-prompt" && reader.title === null && typeof line.lastPrompt === "string" && line.lastPrompt.trim()) reader.title = line.lastPrompt.trim().slice(0, 80);
    if (line.type === "system" && line.subtype === "compact_boundary") {
      const meta = asObject(line.compactMetadata);
      if (meta?.trigger === "manual") reader.compacted();
      else reader.break(at, "compacted", meta ? asCount(meta.preTokens) || null : null);
      continue;
    }
    const message = asObject(line.message);
    if (!message) continue;
    const content = Array.isArray(message.content) ? message.content : [];
    if (line.type === "assistant") {
      if (line.isApiErrorMessage === true && TOO_LONG.test(content.map((part) => asText(asObject(part)?.text)).join(" "))) {
        reader.break(at, "overflow", null);
        continue;
      }
      const usage = asObject(message.usage);
      const id = typeof message.id === "string" ? message.id : null;
      if (usage && (id === null || !seen.has(id))) {
        if (id !== null) seen.add(id);
        const window = asCount(usage.input_tokens) + asCount(usage.cache_creation_input_tokens) + asCount(usage.cache_read_input_tokens);
        if (window + asCount(usage.output_tokens) > 0) reader.reply(window, asCount(usage.output_tokens));
      }
      for (const entry of content) {
        const part = asObject(entry);
        if (part?.type !== "tool_use" || typeof part.name !== "string" || typeof part.id !== "string") continue;
        const tool = collagenTool(part.name);
        if (tool) reader.call(part.id, tool, JSON.stringify(part.input ?? {}), at);
      }
    } else if (line.type === "user") {
      for (const entry of content) {
        const part = asObject(entry);
        if (part?.type === "tool_result" && typeof part.tool_use_id === "string") reader.result(part.tool_use_id, resultText(part.content));
      }
    }
  }
  return sessionCost("claude-code", file, reader);
}
