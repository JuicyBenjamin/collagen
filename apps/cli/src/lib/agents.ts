import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Effect, Option } from "effect";
import { McpSchema } from "effect/ai";
import { sessionDirs, type SessionDirs } from "./transcripts";

// Which agent is acting. Every tool call arrives over an MCP connection, and
// the connection says which harness opened it (its clientInfo): that is the
// agent a review, a settle, a filing or a message is attributed to, beside
// the person it acted for — with the model and effort of the turn that made
// the call, as the call itself says them (MCP's handshake carries neither,
// and both may change from one turn to the next): Codex sends them with each
// call; Claude Code sends the call's id, and its session log holds them on
// that call's entry. Nothing is guessed: a call that says neither names the
// agent alone. One place, so whatever else needs to know which agent is on
// the line asks the same thing.

/** The harnesses we know, by the name their MCP client gives. */
const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude[-_ ]?code/i, "Claude Code"],
  [/^codex/i, "Codex"],
  [/^cursor/i, "Cursor"],
  [/^gemini/i, "Gemini CLI"],
  [/^(vscode|visual studio code)/i, "VS Code"],
  [/^windsurf/i, "Windsurf"],
  [/^zed/i, "Zed"],
];

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** An MCP client as a person reads it: "Claude Code", "Codex" — or, for one
 *  we do not know, its own title or name. Never empty: no name is no agent. */
export const agentName = (info: { readonly name: string; readonly title?: string | undefined }): string | undefined => {
  // one line: the name goes on rows and into sentences, on every peer
  const name = oneLine(info.name);
  const known = KNOWN.find(([pattern]) => pattern.test(name));
  if (known) return known[1];
  const own = oneLine(info.title ?? "") || name;
  return own.length > 0 ? own.slice(0, 40) : undefined;
};

/** The model and effort of the turn that made a tool call. */
export interface Turn {
  readonly model?: string;
  readonly effort?: string;
}

const parsed = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined);
const objectOf = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
const pick = (model: string | undefined, effort: string | undefined): Turn => ({ ...(model ? { model } : {}), ...(effort ? { effort } : {}) });

/** What a call says of its own turn, in its `_meta`, as the harness sent it:
 *  Codex the turn's model and effort outright (`x-codex-turn-metadata`, from
 *  its settings for that turn); Claude Code the call's id
 *  (`claudecode/toolUseId`), the id its session log puts on the entry that
 *  holds them. Null when it says neither: then nothing is guessed. */
export type CallSays = { readonly turn: Turn } | { readonly claudeCall: string } | null;
export const callSays = (meta: unknown): CallSays => {
  const fields = objectOf(meta);
  const codex = objectOf(fields["x-codex-turn-metadata"]);
  const turn = pick(text(codex.model), text(codex.reasoning_effort));
  if (turn.model !== undefined || turn.effort !== undefined) return { turn };
  const id = text(fields["claudecode/toolUseId"]);
  return id ? { claudeCall: id } : null;
};

/** The model and effort on the Claude Code log entry that holds call `id` —
 *  the entry's own, as the harness wrote them — or null when the log (or
 *  its tail: a first line cut short is skipped) does not hold it. */
export function claudeTurn(log: string, id: string): Turn | null {
  for (const raw of log.split("\n")) {
    const line = parsed(raw);
    if (!line || line.type !== "assistant") continue;
    const message = objectOf(line.message);
    const content = Array.isArray(message.content) ? message.content : [];
    if (content.some((part) => objectOf(part).type === "tool_use" && objectOf(part).id === id)) return pick(text(message.model), text(line.effort));
  }
  return null;
}

/** A model as a person reads it: "claude-opus-5-5" is "Opus 5.5"; one we do
 *  not know keeps its own id. */
export const modelName = (id: string): string => {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) return `${claude[1]![0]!.toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  return id.replace(/^gpt-/, "GPT-");
};

/** The agent with its turn: "Claude Code (Opus 5.5, high effort)" — in
 *  brackets, so it reads as one name in a line that has dots of its own. */
export const agentLabel = (name: string, turn: Turn | null): string => {
  const turnSaid = [turn?.model ? modelName(turn.model) : undefined, turn?.effort ? `${turn.effort} effort` : undefined].filter((part) => part !== undefined);
  return turnSaid.length > 0 ? `${name} (${turnSaid.join(", ")})` : name;
};

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

/** Which Claude Code log each MCP connection's calls are written in, once one was found there. */
const logOf = new Map<number, string>();

/** The turn behind Claude Code's call `id`, from the session log that holds
 *  it — the connection's own when it is known, else whichever written this
 *  last minute does. Null when none holds it. */
export async function claudeTurnOf(id: string, connection: number | undefined, now: number, dirs: SessionDirs = sessionDirs()): Promise<Turn | null> {
  const known = connection === undefined ? undefined : logOf.get(connection);
  if (known) {
    const turn = claudeTurn(await tailOf(known).catch(() => ""), id);
    if (turn) return turn;
  }
  for (const file of await written(join(dirs.claude, "projects"), now - RECENT_MS, 4)) {
    if (file === known) continue;
    const turn = claudeTurn(await tailOf(file).catch(() => ""), id);
    if (!turn) continue;
    if (connection !== undefined) logOf.set(connection, file);
    return turn;
  }
  return null;
}

/** The agent behind the tool call being handled — with its turn's model and
 *  effort when the call says them exactly, its name alone when it does not —
 *  or undefined outside one: the person's own TUI, the review page, a
 *  background delivery. */
export const actingAgent: Effect.Effect<string | undefined> = Effect.gen(function* () {
  const context = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpRequestContext));
  const name = context?.clientInfo ? agentName(context.clientInfo) : undefined;
  if (!name) return undefined;
  const says = callSays(context?.requestMetadata);
  if (!says) return name;
  if ("turn" in says) return agentLabel(name, says.turn);
  const now = yield* Clock.currentTimeMillis;
  const turn = yield* Effect.promise(() => claudeTurnOf(says.claudeCall, context?.clientId, now).catch(() => null));
  return agentLabel(name, turn);
});

/** Who did it, for an agent to read: "Juicy's Codex", or "Juicy" when the
 *  person did it themselves (or nobody knows). */
export const actedBy = (person: string, agent: string | undefined): string => (agent ? `${person}'s ${agent}` : person);

/** The same, for a person to read beside a name: " via Codex", or nothing. */
export const via = (agent: string | undefined): string => (agent ? ` via ${agent}` : "");
