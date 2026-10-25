import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionDirs } from "./transcripts";

// What collagen costs an AI, read from the session logs Claude Code and Codex
// already keep on this machine. Collagen has no AI of its own: its cost is
// what its tool calls put into the agent's context window — the arguments
// the agent writes and the results it reads — and how long those stay there.
// Only counts and sizes come out of here, never what was said.

/** Roughly how many characters make a token, for text whose tokens no log
 *  counts on their own (a tool call's share of a reply's window). */
export const CHARS_PER_TOKEN = 4;
export const tokensOf = (chars: number): number => Math.round(chars / CHARS_PER_TOKEN);

/** What a collagen tool call is for, so the total splits by kind. */
export type CallKind = "filing" | "review" | "tickets" | "messages" | "room" | "setup" | "scripting" | "diagnostics" | "other";

const KINDS: Record<string, CallKind> = {
  "create-ticket": "filing",
  "ask-review": "filing",
  "assume-review": "filing",
  "claim-review": "filing",
  "ask-plan": "filing",
  propose: "filing",
  "report-bug": "filing",
  epic: "filing",
  "post-review": "review",
  "settle-step": "review",
  "take-step": "review",
  "close-ticket": "review",
  "open-review": "review",
  "open-merges": "review",
  "review-comments": "review",
  "review-context": "review",
  "get-tickets": "tickets",
  "send-to-peer": "messages",
  "pending-threads": "messages",
  "get-messages": "messages",
  "await-messages": "messages",
  "adopt-thread": "messages",
  "drive-peer": "messages",
  "list-room": "room",
  "watch-room": "room",
  "watch-ticket": "messages",
  "list-rooms": "room",
  "add-project": "setup",
  "remove-project": "setup",
  "order-projects": "setup",
  "set-ai": "setup",
  "set-steering": "setup",
  "merge-review": "setup",
  "set-settings": "setup",
  "set-merging": "setup",
  themes: "setup",
  "set-theme": "setup",
  "add-theme": "setup",
  "edit-theme": "setup",
  "remove-theme": "setup",
  "set-name": "setup",
  "rename-room": "setup",
  "create-room": "setup",
  "join-room": "setup",
  "switch-room": "setup",
  "leave-room": "setup",
  execute: "scripting",
  "search-tools": "scripting",
  "describe-scripting": "scripting",
  "request-transcripts": "diagnostics",
  "share-transcripts": "diagnostics",
  "list-transcripts": "diagnostics",
  "attach-files": "diagnostics",
  "fetch-attachments": "diagnostics",
  "token-cost": "diagnostics",
};
export const kindOf = (tool: string): CallKind => KINDS[tool] ?? "other";

/** The MCP server names collagen registers as: `collagen`, `collagen-devnet`,
 *  either with `-<profile>` (see mcpServerName). */
export const isCollagenServer = (server: string): boolean => /^collagen(-[A-Za-z0-9_-]+)?$/.test(server);

/** The collagen tool a model-facing tool name stands for, or null. Claude
 *  Code names MCP tools `mcp__<server>__<tool>`; Codex has used
 *  `mcp__<server>__<tool>`, `<server>__<tool>` and `<server>.<tool>`, and may
 *  carry the server as a separate namespace. */
export function collagenTool(name: string, namespace?: string): string | null {
  if (namespace !== undefined && isCollagenServer(namespace.replace(/^mcp__|__$/g, ""))) return name.replace(/^.*(__|\.)/, "");
  const match = /^(?:mcp__)?([A-Za-z0-9_-]+?)(?:__|\.)([A-Za-z0-9_-]+)$/.exec(name);
  return match && isCollagenServer(match[1]!) ? match[2]! : null;
}

/** One collagen tool call. */
export interface Call {
  readonly tool: string;
  readonly kind: CallKind;
  readonly argChars: number;
  readonly resultChars: number;
  /** Ticket ids this call names, as far as its arguments (or, for a call
   *  that files a ticket, its result) show — matched later, not parsed. */
  readonly text: string;
}

/** The AI ran out of window: it compacted on its own, or a request was
 *  refused as too long. A compaction the person asked for is not a break. */
export interface ContextBreak {
  readonly at: string | null;
  readonly how: "compacted" | "overflow";
  /** Tokens in the window just before, when the log says. */
  readonly windowBefore: number | null;
  /** Collagen's calls in the stretch since the previous break. */
  readonly collagenCalls: number;
  readonly collagenChars: number;
  readonly largest: { readonly tool: string; readonly chars: number } | null;
  /** Distinct tickets those calls named — load, as opposed to bloat. */
  readonly ticketsTouched: number;
}

export interface SessionCost {
  readonly ai: "claude-code" | "codex";
  readonly file: string;
  readonly calls: ReadonlyArray<Call>;
  /** Model replies (Claude) or steps (Codex) whose usage the log records. */
  readonly replies: number;
  /** Input tokens read over the whole session, cached or not. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Of `inputTokens`, roughly how many were collagen's calls, read again
   *  on every reply they stayed in the window for. */
  readonly collagenInputTokens: number;
  readonly peakWindow: number;
  /** The model's window, when the log says (Codex does, Claude Code not). */
  readonly contextWindow: number | null;
  readonly breaks: ReadonlyArray<ContextBreak>;
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const asCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const asText = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value));

/** The text a tool result carries, whatever shape it came in. */
const resultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : typeof asObject(part)?.text === "string" ? (asObject(part)!.text as string) : asText(part))).join("");
  const wrapper = asObject(content);
  if (wrapper && "content" in wrapper) return resultText(wrapper.content);
  return asText(content);
};

const TOO_LONG = /prompt is too long|context[ _-]?(window|length)[ _-]?(exceeded|limit)|ran out of room|exceeds the context window/i;

/** A session being read: calls, how much of the window each reply carried,
 *  and the window's collagen share at that moment. */
class Reader {
  readonly calls: Array<Call> = [];
  readonly breaks: Array<ContextBreak> = [];
  private readonly pending = new Map<string, { tool: string; args: string }>();
  private readonly ids = new Set<string>();
  private sinceBreak: Array<Call> = [];
  private inWindow = 0; // collagen chars in the window now
  private activity = false; // anything since the last break
  replies = 0;
  inputTokens = 0;
  outputTokens = 0;
  collagenInputTokens = 0;
  peakWindow = 0;
  contextWindow: number | null = null;
  lastWindow: number | null = null;

  /** A call already seen under this id (Codex can log one call twice). */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  call(id: string, tool: string, args: string) {
    this.ids.add(id);
    this.pending.set(id, { tool, args });
    this.activity = true;
  }

  result(id: string, text: string) {
    const asked = this.pending.get(id);
    if (!asked) return;
    this.pending.delete(id);
    const kind = kindOf(asked.tool);
    const call: Call = { tool: asked.tool, kind, argChars: asked.args.length, resultChars: text.length, text: kind === "filing" ? `${asked.args}\n${text}` : asked.args };
    this.calls.push(call);
    this.sinceBreak.push(call);
    this.inWindow += call.argChars + call.resultChars;
  }

  reply(window: number, output: number) {
    this.replies++;
    this.activity = true;
    this.inputTokens += window;
    this.outputTokens += output;
    this.collagenInputTokens += Math.min(window, tokensOf(this.inWindow));
    this.peakWindow = Math.max(this.peakWindow, window);
    this.lastWindow = window;
  }

  /** The window was emptied: nothing collagen said is in it any more. */
  break(at: string | null, how: ContextBreak["how"], windowBefore: number | null) {
    // a break with nothing since the previous one is that one, logged twice
    if (!this.activity && this.breaks.length > 0) return;
    const largest = this.sinceBreak.reduce<{ tool: string; chars: number } | null>(
      (largestSoFar, call) => (largestSoFar && largestSoFar.chars >= call.resultChars ? largestSoFar : { tool: call.tool, chars: call.resultChars }),
      null,
    );
    const tickets = new Set(this.sinceBreak.flatMap((call) => call.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []));
    this.breaks.push({
      at,
      how,
      windowBefore: windowBefore ?? this.lastWindow,
      collagenCalls: this.sinceBreak.length,
      collagenChars: this.sinceBreak.reduce((sum, call) => sum + call.argChars + call.resultChars, 0),
      largest,
      ticketsTouched: tickets.size,
    });
    this.sinceBreak = [];
    this.inWindow = 0;
    this.activity = false;
  }

  /** A compaction the person asked for empties the window but is no break. */
  compacted() {
    this.sinceBreak = [];
    this.inWindow = 0;
    this.activity = false;
  }
}

const lines = function* (jsonl: string): Generator<Json> {
  for (const raw of jsonl.split("\n")) {
    if (raw.length === 0) continue;
    try {
      const line = asObject(JSON.parse(raw));
      if (line) yield line;
    } catch {
      /* a torn last line — skip */
    }
  }
};

/** A Claude Code session (`<claude>/projects/<slug>/<session>.jsonl`). A reply
 *  spans several lines that repeat its usage, so usage counts once per
 *  message id. Compactions are `compact_boundary` system lines. */
export function readClaude(jsonl: string, file = ""): SessionCost {
  const reader = new Reader();
  const seen = new Set<string>();
  for (const line of lines(jsonl)) {
    const at = typeof line.timestamp === "string" ? line.timestamp : null;
    if (line.type === "system" && line.subtype === "compact_boundary") {
      const meta = asObject(line.compactMetadata);
      if (meta?.trigger === "manual") reader.compacted();
      else reader.break(at, "compacted", meta ? asCount(meta.preTokens) || null : null);
      continue;
    }
    const message = asObject(line.message);
    if (!message) continue;
    const content = Array.isArray(message.content) ? message.content : [];
    if (line.type === "assistant") {
      if (line.isApiErrorMessage === true && TOO_LONG.test(content.map((part) => asText(asObject(part)?.text)).join(" "))) {
        reader.break(at, "overflow", null);
        continue;
      }
      const usage = asObject(message.usage);
      const id = typeof message.id === "string" ? message.id : null;
      if (usage && (id === null || !seen.has(id))) {
        if (id !== null) seen.add(id);
        const window = asCount(usage.input_tokens) + asCount(usage.cache_creation_input_tokens) + asCount(usage.cache_read_input_tokens);
        if (window + asCount(usage.output_tokens) > 0) reader.reply(window, asCount(usage.output_tokens));
      }
      for (const entry of content) {
        const part = asObject(entry);
        if (part?.type !== "tool_use" || typeof part.name !== "string" || typeof part.id !== "string") continue;
        const tool = collagenTool(part.name);
        if (tool) reader.call(part.id, tool, JSON.stringify(part.input ?? {}));
      }
    } else if (line.type === "user") {
      for (const entry of content) {
        const part = asObject(entry);
        if (part?.type === "tool_result" && typeof part.tool_use_id === "string") reader.result(part.tool_use_id, resultText(part.content));
      }
    }
  }
  return done("claude-code", file, reader);
}

/** A Codex session (`<codex>/sessions/…/rollout-*.jsonl`). Usage comes as
 *  `token_count` events — the last step's input is the window, and the model's
 *  window size is given. A compaction is a `compacted` line or a
 *  `context_compacted` event; an overflow is an error event saying so. */
export function readCodex(jsonl: string, file = ""): SessionCost {
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
        if (tool && !reader.has(id)) reader.call(id, tool, asText(payload.arguments));
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
        reader.call(id, inv.tool, asText(inv.arguments));
        reader.result(id, resultText(asObject(payload.result)?.Ok ?? payload.result));
      }
    }
  }
  return done("codex", file, reader);
}

const done = (ai: SessionCost["ai"], file: string, reader: Reader): SessionCost => ({
  ai,
  file,
  calls: reader.calls,
  replies: reader.replies,
  inputTokens: reader.inputTokens,
  outputTokens: reader.outputTokens,
  collagenInputTokens: reader.collagenInputTokens,
  peakWindow: reader.peakWindow,
  contextWindow: reader.contextWindow,
  breaks: reader.breaks,
});

/** Every `.jsonl` under `dir` changed since `since` (ms). */
async function sessionFiles(dir: string, since: number, depth: number): Promise<Array<string>> {
  if (depth < 0) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Array<string> = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sessionFiles(path, since, depth - 1)));
    else if (entry.name.endsWith(".jsonl") && (await stat(path).then((stats) => stats.mtimeMs >= since, () => false))) out.push(path);
  }
  return out;
}

/** The sessions on this machine, changed since `since`, that called collagen
 *  at all. Claude Code keeps sub-agents' sessions beside their parent's. One
 *  file at a time, listed and read without blocking: the room runs on this
 *  loop too. */
export async function readSessions(dirs: SessionDirs, since: number): Promise<ReadonlyArray<SessionCost>> {
  const files = [
    ...(await sessionFiles(join(dirs.claude, "projects"), since, 4)).map((file) => ["claude-code", file] as const),
    ...(await sessionFiles(join(dirs.codex, "sessions"), since, 5)).map((file) => ["codex", file] as const),
  ];
  const out: Array<SessionCost> = [];
  for (const [ai, file] of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (!text.includes("collagen")) continue;
    const session = ai === "claude-code" ? readClaude(text, file) : readCodex(text, file);
    if (session.calls.length > 0) out.push(session);
  }
  return out;
}

/** Per tool: how often, how much in and out, the largest result. */
export interface ToolTotal {
  readonly tool: string;
  readonly kind: CallKind;
  readonly calls: number;
  readonly argChars: number;
  readonly resultChars: number;
  readonly largestResult: number;
}

export function byTool(calls: ReadonlyArray<Call>): ReadonlyArray<ToolTotal> {
  const totals = new Map<string, { tool: string; kind: CallKind; calls: number; argChars: number; resultChars: number; largestResult: number }>();
  for (const call of calls) {
    const total = totals.get(call.tool) ?? { tool: call.tool, kind: call.kind, calls: 0, argChars: 0, resultChars: 0, largestResult: 0 };
    total.calls++;
    total.argChars += call.argChars;
    total.resultChars += call.resultChars;
    total.largestResult = Math.max(total.largestResult, call.resultChars);
    totals.set(call.tool, total);
  }
  return [...totals.values()].sort((a, b) => b.argChars + b.resultChars - (a.argChars + a.resultChars));
}

/** The calls that name a ticket: its id (or the 8-character short form) in
 *  what the agent passed, or in what a filing call got back. */
export const callsOn = (calls: ReadonlyArray<Call>, ticketId: string): ReadonlyArray<Call> => {
  const short = ticketId.slice(0, 8);
  return calls.filter((call) => call.text.includes(ticketId) || (short.length === 8 && call.text.includes(short)));
};

/** "12k", "1.4M": a token count at a glance. */
export const compact = (count: number): string =>
  count >= 1_000_000_000 ? `${(count / 1_000_000_000).toFixed(1)}B` : count >= 1_000_000 ? `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
