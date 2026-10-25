import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Effect, Option } from "effect";
import { McpSchema } from "effect/ai";
import type { Acting, Conversation, Harness } from "@collagen/p2p";
import { sessionDirs, type SessionDirs } from "./transcripts";

// Which agent is acting. Every tool call arrives over an MCP connection, and
// the connection says which harness opened it (its clientInfo): that is the
// agent a review, a settle, a filing or a message is attributed to, beside
// the person it acted for — with the model and effort of the turn that made
// the call, and the conversation it came from, as the call itself says them
// (MCP's handshake carries none of these, and they change from one turn and
// one conversation to the next): Codex sends its thread and the turn's model
// and effort with each call; Claude Code sends the call's id, and the session
// log entry holding it names the session, the model and the effort. Nothing
// is guessed: a call that says none of it names the agent alone. One place,
// so whatever else needs to know which agent is on the line asks the same thing.

/** The harnesses we know, by the name their MCP client gives — and, for the
 *  two whose conversations we can tell, which. */
const KNOWN: ReadonlyArray<readonly [RegExp, string, Harness?]> = [
  [/^claude[-_ ]?code/i, "Claude Code", "claude-code"],
  [/^codex/i, "Codex", "codex"],
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

/** The harness an MCP client is, when it is one whose conversations we can
 *  tell; undefined for any other — its acts carry a name, no conversation. */
export const harnessOf = (info: { readonly name: string }): Harness | undefined => KNOWN.find(([pattern]) => pattern.test(oneLine(info.name)))?.[2];

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

/** What a call says of itself, in its `_meta`, as the harness sent it:
 *  Codex its thread (`threadId`) and the turn's model and effort outright
 *  (`x-codex-turn-metadata`, from its settings for that turn); Claude Code
 *  the call's id (`claudecode/toolUseId`), the id its session log puts on the
 *  entry that holds the rest. Null when it says none of it: then nothing is
 *  guessed. */
export type CallSays = { readonly turn: Turn; readonly thread?: string } | { readonly claudeCall: string } | null;
export const callSays = (meta: unknown): CallSays => {
  const fields = objectOf(meta);
  const codex = objectOf(fields["x-codex-turn-metadata"]);
  const turn = pick(text(codex.model), text(codex.reasoning_effort));
  const thread = text(fields.threadId);
  if (turn.model !== undefined || turn.effort !== undefined || thread !== undefined) return { turn, ...(thread ? { thread } : {}) };
  const id = text(fields["claudecode/toolUseId"]);
  return id ? { claudeCall: id } : null;
};

/** What Claude Code's log says of one of its calls: the turn's model and
 *  effort, and the session it was made in. */
export interface ClaudeCall {
  readonly turn: Turn;
  readonly session?: string;
}

/** The Claude Code log entry that holds call `id`: its model and effort, and
 *  the session it names — the entry's own `sessionId`, so a call made by a
 *  subagent (logged under `<session>/subagents/`) names its conversation, not
 *  the subagent — or null when the log (or its tail: a first line cut short
 *  is skipped) does not hold it. */
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

/** The Claude Code logs that held calls lately, the latest first: the next
 *  call is most likely in one of them, so they are read before the rest.
 *  (A connection id would not do: over HTTP every request gets a new one.) */
const lately: Array<string> = [];
const LATELY = 8;

/** The call behind Claude Code's call `id`, from the session log that holds
 *  it — one that held a call lately first, else whichever written this last
 *  minute does. Null when none holds it. */
export async function claudeCallOf(id: string, now: number, dirs: SessionDirs = sessionDirs()): Promise<ClaudeCall | null> {
  const recent = await written(join(dirs.claude, "projects"), now - RECENT_MS, 4);
  const first = lately.filter((file) => recent.includes(file));
  for (const file of [...first, ...recent.filter((file) => !first.includes(file))]) {
    const call = claudeCall(await tailOf(file).catch(() => ""), id);
    if (!call) continue;
    lately.splice(0, lately.length, file, ...lately.filter((other) => other !== file).slice(0, LATELY - 1));
    return call;
  }
  return null;
}

/** A conversation of `harness`, when the call named one and the harness is
 *  one whose conversations we can tell. */
const conversationOf = (harness: Harness | undefined, id: string | undefined): Conversation | undefined => (harness && id ? { ai: harness, id } : undefined);

/** The agent behind the tool call being handled — its name with its turn's
 *  model and effort when the call says them exactly, and the conversation it
 *  came from when the call says that — or undefined outside one: the
 *  person's own TUI, the review page, a background delivery. */
export const acting: Effect.Effect<Acting | undefined> = Effect.gen(function* () {
  const context = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpRequestContext));
  const name = context?.clientInfo ? agentName(context.clientInfo) : undefined;
  if (!name || !context?.clientInfo) return undefined;
  const harness = harnessOf(context.clientInfo);
  const says = callSays(context.requestMetadata);
  if (!says) return { agent: name };
  if ("turn" in says) {
    const conversation = conversationOf(harness, says.thread);
    return { agent: agentLabel(name, says.turn), ...(conversation ? { conversation } : {}) };
  }
  const now = yield* Clock.currentTimeMillis;
  const call = yield* Effect.promise(() => claudeCallOf(says.claudeCall, now).catch(() => null));
  const conversation = conversationOf(harness, call?.session);
  return { agent: agentLabel(name, call?.turn ?? null), ...(conversation ? { conversation } : {}) };
});

/** Who did it, for an agent to read: "Juicy's Codex", or "Juicy" when the
 *  person did it themselves (or nobody knows). */
export const actedBy = (person: string, agent: string | undefined): string => (agent ? `${person}'s ${agent}` : person);

/** The same, for a person to read beside a name: " via Codex", or nothing. */
export const via = (agent: string | undefined): string => (agent ? ` via ${agent}` : "");
