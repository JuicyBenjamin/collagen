import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/** Where the agent CLIs keep their conversations. Both honour an env
 *  override (Claude Code: CLAUDE_CONFIG_DIR; Codex: CODEX_HOME), so do we. */
export interface SessionDirs {
  readonly claude: string;
  readonly codex: string;
}
export const sessionDirs = (env: NodeJS.ProcessEnv = process.env, home = homedir()): SessionDirs => ({
  claude: env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
  codex: env.CODEX_HOME ?? join(home, ".codex"),
});

/** Every regular file under `dir`, depth-first, or [] when it doesn't exist. */
function walk(dir: string, depth = 6): Array<string> {
  if (depth < 0) return [];
  let names: Array<string>;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<string> = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (statSync(path).isDirectory()) out.push(...walk(path, depth - 1));
      else out.push(path);
    } catch {
      /* vanished — skip */
    }
  }
  return out;
}

/** The session file for an adopted conversation, or null.
 *  Claude Code: `<claude>/projects/<cwd-slug>/<sessionId>.jsonl` — the slug is
 *  the cwd, which we don't know, so every project dir is searched.
 *  Codex: `<codex>/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl` (the
 *  layout is mid-migration to "paginated thread history", so any `.jsonl`
 *  under sessions whose name carries the id counts). */
export function sessionFile(provider: string, sessionId: string, dirs: SessionDirs): string | null {
  if (sessionId.length < 8 || /[/\\]/.test(sessionId)) return null;
  if (provider === "claude-code") {
    return walk(join(dirs.claude, "projects"), 2).find((file) => file.endsWith(`/${sessionId}.jsonl`)) ?? null;
  }
  if (provider === "codex") {
    return walk(join(dirs.codex, "sessions")).find((file) => file.endsWith(".jsonl") && file.includes(sessionId)) ?? null;
  }
  return null;
}

/** The lines of a session file worth handing over: entries stamped at or
 *  after `since` (ms), plus any un-stamped or meta lines that give the rest
 *  its shape (Codex's `session_meta`). Unparseable lines are dropped. */
export function sliceSince(jsonl: string, since: number): { readonly lines: ReadonlyArray<string>; readonly entries: number } {
  const lines: Array<string> = [];
  let entries = 0;
  for (const raw of jsonl.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let parsed: { timestamp?: unknown; type?: unknown };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.type === "session_meta") {
      lines.push(line);
      continue;
    }
    const at = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : typeof parsed.timestamp === "number" ? parsed.timestamp : NaN;
    if (Number.isNaN(at)) {
      lines.push(line); // no stamp: keep, it belongs to whatever surrounds it
      continue;
    }
    if (at >= since) {
      lines.push(line);
      entries++;
    }
  }
  return { lines, entries };
}

/** One session line, readable: when, who, what — for showing a transcript in
 *  the app. Both CLIs' shapes are known here; anything else shows by its type
 *  so nothing is silently hidden. Null = noise not worth a row (token counts,
 *  turn context, attachments). */
export interface TranscriptLine {
  readonly ts: string | null;
  readonly who: string;
  readonly text: string;
}

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const part = item as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
      if (typeof part.text === "string") return part.text;
      if (part.type === "thinking") return "(thinking)";
      if (part.type === "tool_use") return `⚙ ${part.name ?? "tool"} ${JSON.stringify(part.input ?? {}).slice(0, 200)}`;
      if (part.type === "tool_result") return `↳ ${textOf(part.content).slice(0, 200)}`;
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
};

export function readLine(raw: string): TranscriptLine | null {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const stamp = typeof record.timestamp === "string" ? record.timestamp : null;
  const type = typeof record.type === "string" ? record.type : "";
  const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : null;
  // codex rollout
  if (type === "session_meta" && payload) return { ts: stamp, who: "session", text: `${String(payload.originator ?? "codex")} · ${String(payload.cwd ?? "")}` };
  if (type === "response_item" && payload) {
    if (payload.type === "message") return { ts: stamp, who: String(payload.role ?? "message"), text: textOf(payload.content) };
    if (payload.type === "reasoning") return { ts: stamp, who: "reasoning", text: textOf(payload.summary) || "(reasoning, encrypted)" };
    if (payload.type === "function_call") return { ts: stamp, who: "tool call", text: `⚙ ${String(payload.name ?? "")} ${String(payload.arguments ?? "").slice(0, 200)}` };
    if (payload.type === "function_call_output") return { ts: stamp, who: "tool result", text: `↳ ${String(payload.output ?? "").slice(0, 200)}` };
    return { ts: stamp, who: String(payload.type ?? "item"), text: "" };
  }
  if (type === "event_msg" || type === "turn_context") return null;
  // claude code session
  if ((type === "user" || type === "assistant") && record.message && typeof record.message === "object") {
    const message = record.message as { role?: string; content?: unknown };
    return { ts: stamp, who: message.role ?? type, text: textOf(message.content) };
  }
  if (type === "system") return { ts: stamp, who: "system", text: typeof record.content === "string" ? record.content : String(record.subtype ?? "") };
  if (type === "queue-operation") return { ts: stamp, who: `collagen (${String(record.operation ?? "queue")})`, text: typeof record.content === "string" ? record.content : "" };
  // anything else with nothing to say is bookkeeping, not conversation
  return null;
}

/** Wire form of a slice: gzip + base64 of the JSONL. */
export const pack = (lines: ReadonlyArray<string>): string => gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8")).toString("base64");
export const unpack = (data: string): string => gunzipSync(Buffer.from(data, "base64")).toString("utf8");

/** Refuse to ship more than this over an ephemeral frame (gzipped bytes). */
export const MAX_PACKED_BYTES = 8 * 1024 * 1024;
