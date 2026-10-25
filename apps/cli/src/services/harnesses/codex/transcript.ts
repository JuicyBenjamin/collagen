import { textOf, type TranscriptLine } from "../../../lib/transcripts";

// A Codex rollout's lines, as a person reads them in the app.

/** One line of a Codex rollout, readable — null for its bookkeeping (token
 *  counts, turn context), undefined when it is not one of Codex's. */
export const readLine = (record: Readonly<Record<string, unknown>>, stamp: string | null): TranscriptLine | null | undefined => {
  const type = typeof record.type === "string" ? record.type : "";
  const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : null;
  if (type === "session_meta" && payload) return { ts: stamp, who: "session", text: `${String(payload.originator ?? "codex")} · ${String(payload.cwd ?? "")}` };
  if (type === "response_item" && payload) {
    if (payload.type === "message") return { ts: stamp, who: String(payload.role ?? "message"), text: textOf(payload.content) };
    if (payload.type === "reasoning") return { ts: stamp, who: "reasoning", text: textOf(payload.summary) || "(reasoning, encrypted)" };
    if (payload.type === "function_call") return { ts: stamp, who: "tool call", text: `⚙ ${String(payload.name ?? "")} ${String(payload.arguments ?? "").slice(0, 200)}` };
    if (payload.type === "function_call_output") return { ts: stamp, who: "tool result", text: `↳ ${String(payload.output ?? "").slice(0, 200)}` };
    return { ts: stamp, who: String(payload.type ?? "item"), text: "" };
  }
  if (type === "event_msg" || type === "turn_context") return null;
  return undefined;
};

/** The session header gives a handed-over slice its shape: always kept. */
export const keepsWhole = (record: Readonly<Record<string, unknown>>): boolean => record.type === "session_meta";
