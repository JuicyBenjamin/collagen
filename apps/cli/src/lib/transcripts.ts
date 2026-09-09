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

/** Wire form of a slice: gzip + base64 of the JSONL. */
export const pack = (lines: ReadonlyArray<string>): string => gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8")).toString("base64");
export const unpack = (data: string): string => gunzipSync(Buffer.from(data, "base64")).toString("utf8");

/** Refuse to ship more than this over an ephemeral frame (gzipped bytes). */
export const MAX_PACKED_BYTES = 8 * 1024 * 1024;
