import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Context, Effect, Layer, Option } from "effect";
import type { RoomMessage } from "@collagen/p2p";
import { steeringLine, type Level } from "../lib/steering";
import { actedBy } from "../lib/agents";
import { Harnesses } from "./Harness";

export interface SpawnCtx {
  cwd: string;
  mcpUrl: string;
  serverName: string;
  message: RoomMessage;
  sessionId: Option.Option<string>;
  /** the person's work level (lib/steering); absent = not chosen */
  steering?: Level;
}

export interface Adapter {
  cmd: string;
  args: (o: SpawnCtx) => string[];
  parse: (out: string) => { sessionId?: string; result?: string };
  /** Cheap auth probe: command + how to read "logged in" from its output. */
  auth: {
    args: string[];
    /** exitCode/out from running `cmd auth.args` */
    loggedIn: (out: string, exitCode: number) => boolean;
  };
}

/** Words someone else wrote, made safe to quote in one line: no line breaks
 *  or quotes to step out of it, and short. */
const quoted = (text: string, most = 60): string => text.replace(/[\r\n"'`<>]+/g, " ").trim().slice(0, most);

/** The words that wake a conversation of the person's, whatever its harness
 *  (and a mock's run): who they are from — collagen, never the person —
 *  and the headline; the details stay in collagen until the person asks.
 *  Human in the loop: the agent relays, never decides; what it can't find in
 *  the thread is either its own user's to answer (from this repo, under
 *  direction) or the other peer's (then it drafts the question). What
 *  someone else wrote is quoted so it cannot step out of its place. */
export function wakeLine(spawnContext: SpawnCtx): string {
  const { message } = spawnContext;
  const verb = Option.isSome(spawnContext.sessionId) ? "a new message arrived in this conversation" : "a new conversation was started";
  const who = actedBy(quoted(message.fromName, 40), message.agent ? quoted(message.agent) : undefined);
  const project = quoted(message.project, 40);
  const ticketNote = message.ticketId ? ` (ticket ${message.ticketId}; get-ticket shows it)` : "";
  const headline = message.intent.startsWith("ticket-update:")
    ? `Collagen (not your user): ${who} ${quoted(message.intent.slice("ticket-update:".length))} on a ticket your user is part of, project "${project}"${ticketNote}.`
    : `Collagen (not your user): ${verb} — ${who} asks your user to address "${quoted(message.intent)}" on project "${project}"${ticketNote}.`;
  const level = spawnContext.steering ?? "unset";
  return [
    headline,
    level === "ask" || level === "unset"
      ? `Tell your user exactly that, in one line, and wait. Do not read the details yet, do not investigate, decide or answer anything: a person decides here.`
      : `Tell your user exactly that, in one line. ${steeringLine(level)}`,
    `If your user asks what it says or wants more, read it with the ${spawnContext.serverName} get-messages tool, threadId "${message.threadId}" (a ticket's steps: get-ticket), and relay what is there — never fill gaps from your own head.`,
    `If your user then asks something the thread does not answer, decide which it is: yours to answer from this repo under their direction, or ${quoted(message.fromName, 40)}'s to answer — then draft that question for them with send-to-peer.`,
    `Anything you send is only what your user decided — it goes to the room as soon as you send it, and the collagen TUI's outbox shows them what went.`,
  ].join(" ");
}

// Mock: a real spawn of a tiny node script that does the full agent dance
// (MCP handshake → get-messages → send-to-peer ack) with canned "thinking".
// Lets a machine without any LLM CLI be a complete peer in a cross-network
// test — everything downstream of the adapter (AgentRunner, MCP, swarm) is
// exercised for real.
// Next to the built entry (dist/) or in src/dev when running from source.
const mockAgentPath = [new URL("./mock-agent.mjs", import.meta.url), new URL("../dev/mock-agent.mjs", import.meta.url)]
  .map((url) => fileURLToPath(url))
  .find((candidate) => existsSync(candidate)) ?? fileURLToPath(new URL("../dev/mock-agent.mjs", import.meta.url));

export const mockAdapter: Adapter = {
  cmd: process.execPath,
  auth: {
    args: ["--version"],
    loggedIn: (_out, exitCode) => exitCode === 0,
  },
  args: (spawnContext) => [
    mockAgentPath,
    spawnContext.mcpUrl,
    spawnContext.message.threadId,
    spawnContext.message.fromName,
    spawnContext.message.project,
    spawnContext.message.intent,
    // the stored session id doubles as the mock's memory: it encodes how many
    // acks this thread got ("mock#N"), so the cap survives across spawns
    Option.getOrElse(spawnContext.sessionId, () => "fresh"),
  ],
  parse: (out) => {
    try {
      const output = JSON.parse(out) as { session_id?: string; result?: string };
      return { sessionId: output.session_id, result: output.result };
    } catch {
      return {};
    }
  },
};

/** Injectable spawn-adapter registry, keyed by the `preferredAi` value.
 *  Tests provide fakes here instead of spawning real agent CLIs. */
export class Adapters extends Context.Service<Adapters, Readonly<Record<string, Adapter>>>()("cli/Adapters") {}

/** A mock of each harness, "mock:<harness id>": one behavior, many names —
 *  the point is the label: peers see "mock:claude-code" in the room and know
 *  no real AI sits behind this peer. Always available, so a machine without
 *  any LLM subscription can be a full peer out of the box. */
export const AdaptersLive = Layer.effect(
  Adapters,
  Effect.gen(function* () {
    return Object.fromEntries((yield* Harnesses).map((harness) => [`mock:${harness.id}`, mockAdapter]));
  }),
);

/** What a person can pick as their AI: none, each harness, and each mock. */
export const aiChoices = Effect.gen(function* () {
  const harnesses = yield* Harnesses;
  const adapters = yield* Adapters;
  return [null, ...harnesses.map((harness) => harness.id), ...Object.keys(adapters).filter((name) => name.startsWith("mock:"))] as ReadonlyArray<string | null>;
});
