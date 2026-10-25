import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Turn } from "../../../lib/agents";

// Which call, which turn, which session: Claude Code sends the call's id
// (`claudecode/toolUseId`) with each tool call, and the session log entry
// holding it names the session, the model and the effort.

export const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined);
export const objectOf = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
const pick = (model: string | undefined, effort: string | undefined): Turn => ({ ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
const parsed = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** What Claude Code's log says of one of its calls: the turn's model and
 *  effort, and the session it was made in. */
export interface ClaudeCall {
  readonly turn: Turn;
  readonly session?: string;
}

/** The log entry that holds call `id`: its model and effort, and the session
 *  it names — the entry's own `sessionId`, so a call made by a subagent
 *  (logged under `<session>/subagents/`) names its conversation, not the
 *  subagent — or null when the log (or its tail: a first line cut short is
 *  skipped) does not hold it. */
export function claudeCall(log: string, id: string): ClaudeCall | null {
  for (const raw of log.split("\n")) {
    const line = parsed(raw);
    if (!line || line.type !== "assistant") continue;
    const message = objectOf(line.message);
    const content = Array.isArray(message.content) ? message.content : [];
    if (!content.some((part) => objectOf(part).type === "tool_use" && objectOf(part).id === id)) continue;
    const session = text(line.sessionId);
    return { turn: pick(text(message.model), text(line.effort)), ...(session ? { session } : {}) };
  }
  return null;
}

/** How recently a log must have been written to be searched for a call. */
const RECENT_MS = 60_000;
/** How much of a log's end is read for it. */
const TAIL_BYTES = 512 * 1024;

/** Every `.jsonl` under `dir` written since `since` (ms). */
async function written(dir: string, since: number, depth: number): Promise<Array<string>> {
  if (depth < 0) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Array<string> = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await written(path, since, depth - 1)));
    else if (entry.name.endsWith(".jsonl") && (await stat(path).then((stats) => stats.mtimeMs >= since, () => false))) out.push(path);
  }
  return out;
}

const tailOf = async (file: string): Promise<string> => {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
};

/** The logs that held calls lately, the latest first: the next call is most
 *  likely in one of them, so they are read before the rest. (A connection id
 *  would not do: over HTTP every request gets a new one.) */
const lately: Array<string> = [];
const LATELY = 8;

/** The call behind call `id`, from the session log under `home` that holds
 *  it — one that held a call lately first, else whichever written this last
 *  minute does. Null when none holds it. */
export async function claudeCallOf(id: string, now: number, home: string): Promise<ClaudeCall | null> {
  const recent = await written(join(home, "projects"), now - RECENT_MS, 4);
  const first = lately.filter((file) => recent.includes(file));
  for (const file of [...first, ...recent.filter((file) => !first.includes(file))]) {
    const call = claudeCall(await tailOf(file).catch(() => ""), id);
    if (!call) continue;
    lately.splice(0, lately.length, file, ...lately.filter((other) => other !== file).slice(0, LATELY - 1));
    return call;
  }
  return null;
}

