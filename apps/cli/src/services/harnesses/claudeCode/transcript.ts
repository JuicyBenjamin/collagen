import { basename } from "node:path";
import { lines } from "../../../lib/tokenCost";
import { textOf, type TranscriptLine } from "../../../lib/transcripts";
import type { Session } from "../../Harness";

// A Claude Code session log's lines, as a person reads them in the app.

/** One line of a Claude Code session, readable — or undefined when it is not
 *  one of Claude Code's (another harness reads it). */
export const readLine = (record: Readonly<Record<string, unknown>>, stamp: string | null): TranscriptLine | null | undefined => {
  const type = typeof record.type === "string" ? record.type : "";
  if ((type === "user" || type === "assistant") && record.message && typeof record.message === "object") {
    const message = record.message as { role?: string; content?: unknown };
    return { ts: stamp, who: message.role ?? type, text: textOf(message.content) };
  }
  if (type === "system") return { ts: stamp, who: "system", text: typeof record.content === "string" ? record.content : String(record.subtype ?? "") };
  if (type === "queue-operation") return { ts: stamp, who: `collagen (${String(record.operation ?? "queue")})`, text: typeof record.content === "string" ? record.content : "" };
  return undefined;
};

/** What a Claude Code session file records of its conversation: every entry
 *  carries the folder and the git branch it ran on. A sub-agent's session
 *  sits under its parent's (`<parent>/subagents/agent-….jsonl`). */
export const readSession = (jsonl: string, file: string): Session | null => {
  const sub = /\/([^/]+)\/subagents\/([^/]+)\.jsonl$/.exec(file);
  const conversation = sub ? sub[2]! : basename(file, ".jsonl");
  let cwd = "";
  const branches = new Set<string>();
  let startedAt = Number.POSITIVE_INFINITY;
  let endedAt = 0;
  for (const record of lines(jsonl)) {
    if (!cwd && typeof record.cwd === "string") cwd = record.cwd;
    if (typeof record.gitBranch === "string" && record.gitBranch.length > 0 && record.gitBranch !== "HEAD") branches.add(record.gitBranch);
    const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
    if (Number.isFinite(at)) {
      startedAt = Math.min(startedAt, at);
      endedAt = Math.max(endedAt, at);
    }
  }
  if (!cwd || endedAt === 0) return null;
  return { conversation, cwd, branches: [...branches], ...(sub ? { parent: sub[1]! } : {}), startedAt, endedAt };
};
