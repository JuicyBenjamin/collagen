import { Effect, Option } from "effect";
import { McpSchema } from "effect/ai";
import type { Acting } from "@collagen/p2p";
import { harnessOfClient, Harnesses, homesOf, type Harness, type Homes } from "../services/Harness";

// Which agent is acting. Every tool call arrives over an MCP connection, and
// the connection says which harness opened it (its clientInfo): that is the
// agent a review, a settle, a filing or a message is attributed to, beside
// the person it acted for — with the model and effort of the turn that made
// the call, and the conversation it came from, as the call itself says them
// (MCP's handshake carries none of these, and they change from one turn and
// one conversation to the next): each harness reads its own calls (services/
// Harness). Nothing is guessed: a call that says none of it names the agent
// alone. One place, so whatever else needs to know which agent is on the line
// asks the same thing.

/** Other MCP clients we know by name, whose conversations collagen cannot tell. */
const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/^cursor/i, "Cursor"],
  [/^gemini/i, "Gemini CLI"],
  [/^(vscode|visual studio code)/i, "VS Code"],
  [/^windsurf/i, "Windsurf"],
  [/^zed/i, "Zed"],
];

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** An MCP client as a person reads it: a harness's name ("Claude Code"),
 *  another client we know, or for one we do not, its own title or name.
 *  Never empty: no name is no agent. */
export const agentName = (info: { readonly name: string; readonly title?: string | undefined }, harnesses: ReadonlyArray<Harness>): string | undefined => {
  // one line: the name goes on rows and into sentences, on every peer
  const name = oneLine(info.name);
  const harness = harnessOfClient(harnesses, name);
  if (harness) return harness.name;
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

/** A model as a person reads it: "claude-opus-5-5" is "Opus 5.5"; one we do
 *  not know keeps its own id. */
export const modelName = (id: string): string => {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) return `${claude[1]![0]!.toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  return id.replace(/^gpt-/, "GPT-");
};

/** The model a label names, as its maker calls it: "Claude Code (Sonnet
 *  5.5, medium effort)" is "Claude Sonnet 5.5"; a label with no model, none. */
export const modelOfLabel = (label: string): string | undefined => {
  const model = /\(([^,)]+)/.exec(label)?.[1]?.trim();
  if (!model || model.endsWith(" effort")) return undefined;
  return /^(Opus|Sonnet|Haiku|Fable) /.test(model) ? `Claude ${model}` : model;
};

/** The agent with its turn: "Claude Code (Opus 5.5, high effort)" — in
 *  brackets, so it reads as one name in a line that has dots of its own. */
export const agentLabel = (name: string, turn: Turn | null): string => {
  const turnSaid = [turn?.model ? modelName(turn.model) : undefined, turn?.effort ? `${turn.effort} effort` : undefined].filter((part) => part !== undefined);
  return turnSaid.length > 0 ? `${name} (${turnSaid.join(", ")})` : name;
};

/** The agent behind the tool call being handled — its name with its turn's
 *  model and effort when the call says them exactly, and the conversation it
 *  came from when its harness can tell — or undefined outside one: the
 *  person's own TUI, the review page, a background delivery. */
export const actingWith = (harnesses: ReadonlyArray<Harness>, homes: Homes = homesOf(harnesses)): Effect.Effect<Acting | undefined> =>
  Effect.gen(function* () {
    const context = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpRequestContext));
    const name = context?.clientInfo ? agentName(context.clientInfo, harnesses) : undefined;
    if (!name || !context?.clientInfo) return undefined;
    const harness = harnessOfClient(harnesses, context.clientInfo.name);
    const call = harness ? yield* harness.readCall(context.requestMetadata, homes[harness.id] ?? "") : null;
    if (!call) return { agent: name };
    return { agent: agentLabel(name, call.turn), ...(harness && call.conversation ? { conversation: { ai: harness.id, id: call.conversation } } : {}) };
  });

/** The same, with the harnesses in use. */
export const acting: Effect.Effect<Acting | undefined, never, Harnesses> = Effect.gen(function* () {
  return yield* actingWith(yield* Harnesses);
});

/** Who did it, for an agent to read: "Juicy's Codex", or "Juicy" when the
 *  person did it themselves (or nobody knows). */
export const actedBy = (person: string, agent: string | undefined): string => (agent ? `${person}'s ${agent}` : person);

/** The same, for a person to read beside a name: " via Codex", or nothing. */
export const via = (agent: string | undefined): string => (agent ? ` via ${agent}` : "");
