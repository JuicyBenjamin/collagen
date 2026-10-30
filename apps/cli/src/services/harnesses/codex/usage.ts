import { asCount, asObject, asText, collagenTool, isCollagenServer, lines, Reader, resultText, sessionCost, TOO_LONG, type SessionCost } from "../../../lib/tokenCost";

// What collagen costs Codex, from its own session logs.

/** A Codex session (`<codex>/sessions/…/rollout-*.jsonl`). Usage comes as
 *  `token_count` events — the last step's input is the window, and the model's
 *  window size is given. A compaction is a `compacted` line or a
 *  `context_compacted` event; an overflow is an error event saying so. */
export function readUsage(jsonl: string, file = ""): SessionCost {
  const reader = new Reader();
  let lastTotal = -1;
  for (const line of lines(jsonl)) {
    const at = typeof line.timestamp === "string" ? line.timestamp : null;
    const payload = asObject(line.payload) ?? {};
    if (line.type === "compacted") {
      reader.break(at, "compacted", null);
      continue;
    }
    if (line.type === "response_item") {
      if (payload.type === "function_call" && typeof payload.name === "string") {
        const tool = collagenTool(payload.name, typeof payload.namespace === "string" ? payload.namespace : undefined);
        const id = asText(payload.call_id);
        if (tool && !reader.has(id)) reader.call(id, tool, asText(payload.arguments), at);
      } else if (payload.type === "function_call_output") {
        reader.result(asText(payload.call_id), resultText(payload.output));
      }
      continue;
    }
    if (line.type !== "event_msg") continue;
    if (payload.type === "token_count") {
      const info = asObject(payload.info);
      if (!info) continue;
      if (info.model_context_window !== undefined) reader.contextWindow = asCount(info.model_context_window) || reader.contextWindow;
      const total = asCount(asObject(info.total_token_usage)?.total_tokens);
      if (total === lastTotal) continue; // the same step, reported again
      lastTotal = total;
      const last = asObject(info.last_token_usage) ?? {};
      reader.reply(asCount(last.input_tokens), asCount(last.output_tokens) + asCount(last.reasoning_output_tokens));
    } else if (payload.type === "context_compacted") {
      reader.break(at, "compacted", null);
    } else if (payload.type === "error" && TOO_LONG.test(asText(payload.message))) {
      reader.break(at, "overflow", null);
    } else if (payload.type === "mcp_tool_call_end") {
      // older logs carry MCP calls only as events
      const inv = asObject(payload.invocation) ?? {};
      const id = asText(payload.call_id);
      if (typeof inv.server === "string" && isCollagenServer(inv.server) && typeof inv.tool === "string" && !reader.has(id)) {
        reader.call(id, inv.tool, asText(inv.arguments), at);
        reader.result(id, resultText(asObject(payload.result)?.Ok ?? payload.result));
      }
    }
  }
  return sessionCost("codex", file, reader);
}
