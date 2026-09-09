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
  for (const n of names) {
    const p = join(dir, n);
    try {
      if (statSync(p).isDirectory()) out.push(...walk(p, depth - 1));
      else out.push(p);
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
export function sessionFile(ai: string, sessionId: string, dirs: SessionDirs): string | null {
  if (sessionId.length < 8 || /[/\\]/.test(sessionId)) return null;
  if (ai === "claude-code") {
    return walk(join(dirs.claude, "projects"), 2).find((p) => p.endsWith(`/${sessionId}.jsonl`)) ?? null;
  }
  if (ai === "codex") {
    return walk(join(dirs.codex, "sessions")).find((p) => p.endsWith(".jsonl") && p.includes(sessionId)) ?? null;
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
    let obj: { timestamp?: unknown; type?: unknown };
    try {
      obj = JSON.parse(line) as typeof obj;
    } catch {
      continue;
    }
    if (obj.type === "session_meta") {
      lines.push(line);
      continue;
    }
    const ts = typeof obj.timestamp === "string" ? Date.parse(obj.timestamp) : typeof obj.timestamp === "number" ? obj.timestamp : NaN;
    if (Number.isNaN(ts)) {
      lines.push(line); // no stamp: keep, it belongs to whatever surrounds it
      continue;
    }
    if (ts >= since) {
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
    .map((p: unknown) => {
      if (typeof p === "string") return p;
      if (!p || typeof p !== "object") return "";
      const part = p as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
      if (typeof part.text === "string") return part.text;
      if (part.type === "thinking") return "(thinking)";
      if (part.type === "tool_use") return `⚙ ${part.name ?? "tool"} ${JSON.stringify(part.input ?? {}).slice(0, 200)}`;
      if (part.type === "tool_result") return `↳ ${textOf(part.content).slice(0, 200)}`;
      return "";
    })
    .filter((s) => s.length > 0)
    .join("\n");
};

export function readLine(raw: string): TranscriptLine | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ts = typeof o.timestamp === "string" ? o.timestamp : null;
  const type = typeof o.type === "string" ? o.type : "";
  const payload = o.payload && typeof o.payload === "object" ? (o.payload as Record<string, unknown>) : null;
  // codex rollout
  if (type === "session_meta" && payload) return { ts, who: "session", text: `${String(payload.originator ?? "codex")} · ${String(payload.cwd ?? "")}` };
  if (type === "response_item" && payload) {
    if (payload.type === "message") return { ts, who: String(payload.role ?? "message"), text: textOf(payload.content) };
    if (payload.type === "reasoning") return { ts, who: "reasoning", text: textOf(payload.summary) || "(reasoning, encrypted)" };
    if (payload.type === "function_call") return { ts, who: "tool call", text: `⚙ ${String(payload.name ?? "")} ${String(payload.arguments ?? "").slice(0, 200)}` };
    if (payload.type === "function_call_output") return { ts, who: "tool result", text: `↳ ${String(payload.output ?? "").slice(0, 200)}` };
    return { ts, who: String(payload.type ?? "item"), text: "" };
  }
  if (type === "event_msg" || type === "turn_context") return null;
  // claude code session
  if ((type === "user" || type === "assistant") && o.message && typeof o.message === "object") {
    const m = o.message as { role?: string; content?: unknown };
    return { ts, who: m.role ?? type, text: textOf(m.content) };
  }
  if (type === "system") return { ts, who: "system", text: typeof o.content === "string" ? o.content : String(o.subtype ?? "") };
  if (type === "queue-operation") return { ts, who: `collagen (${String(o.operation ?? "queue")})`, text: typeof o.content === "string" ? o.content : "" };
  // anything else with nothing to say is bookkeeping, not conversation
  return null;
}

/** Wire form of a slice: gzip + base64 of the JSONL. */
export const pack = (lines: ReadonlyArray<string>): string => gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8")).toString("base64");
export const unpack = (data: string): string => gunzipSync(Buffer.from(data, "base64")).toString("utf8");

/** Refuse to ship more than this over an ephemeral frame (gzipped bytes). */
export const MAX_PACKED_BYTES = 8 * 1024 * 1024;
