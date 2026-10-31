import { lines } from "../../../lib/tokenCost";
import { textOf, type TranscriptLine } from "../../../lib/transcripts";
import type { Session } from "../../Harness";

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

/** What a Codex rollout records of its thread: its header names the folder,
 *  the git branch and, for a thread another started, that thread. */
export const readSession = (jsonl: string): Session | null => {
  let session: Omit<Session, "endedAt"> | null = null;
  let endedAt = 0;
  for (const record of lines(jsonl)) {
    const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
    if (Number.isFinite(at)) endedAt = Math.max(endedAt, at);
    const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : null;
    if (session || record.type !== "session_meta" || !payload || typeof payload.id !== "string" || typeof payload.cwd !== "string") continue;
    const git = payload.git && typeof payload.git === "object" ? (payload.git as Record<string, unknown>) : null;
    const parent = typeof payload.parent_thread_id === "string" && payload.parent_thread_id !== payload.id ? payload.parent_thread_id : undefined;
    const started = typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : at;
    session = { conversation: payload.id, cwd: payload.cwd, branches: typeof git?.branch === "string" ? [git.branch] : [], ...(parent ? { parent } : {}), startedAt: Number.isFinite(started) ? started : 0 };
  }
  return session ? { ...session, endedAt: Math.max(endedAt, session.startedAt) } : null;
};
