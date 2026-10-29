import { homedir } from "node:os";
import { Context, Layer, type Effect } from "effect";
import type { FileSystem } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import type { Harness as HarnessId, JobKind } from "@collagen/p2p";
import type { Turn } from "../lib/agents";
import type { DeliverAllowed, RunAllowed } from "../lib/steering";
import type { SessionCost } from "../lib/tokenCost";
import type { TranscriptLine } from "../lib/transcripts";
import { claudeCode } from "./harnesses/claudeCode";
import { codex } from "./harnesses/codex";

// The AI tools a person works in, as something collagen can act on: tell
// which one a tool call came from and which of its conversations, reach that
// conversation and wake it in the window the person is in, give it a way to
// keep listening, and read its sessions (transcripts, token use). Every one
// of these differs per harness, so each lives behind this one interface:
// Claude Code and Codex are the first, never the only — another harness is
// one implementation added to HarnessesLive (and its id to Harness in
// @collagen/p2p), not edits across the app. Nothing outside an
// implementation names a harness, and nothing reaches one but through the
// Harnesses layer (skill: harnesses).

/** What a harness's tool call says of itself: the turn's model and effort,
 *  and the conversation it came from — as the call says them, never guessed. */
export interface CallRead {
  readonly turn: Turn | null;
  readonly conversation?: string;
}

/** A job collagen runs this harness for: what to do, with which model, where,
 *  and the collagen MCP server it may call. */
export interface Job {
  readonly prompt: string;
  readonly model?: string;
  readonly cwd: string;
  readonly server: { readonly name: string; readonly url: string };
}

/** How a job went: whether it finished, what it last said, what it spent. */
export interface JobDone {
  readonly ok: boolean;
  readonly said?: string;
  readonly spent?: Spent;
}

/** What a model run collagen made itself spent, as the harness reported it. */
export interface Spent {
  readonly model?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
}

/** Whether a wake reached the conversation (or there was no way to reach it
 *  yet), and what it spent when collagen ran a model to do it. */
export interface Woken {
  readonly reached: boolean;
  readonly spent?: Spent;
}

export interface Harness {
  /** its id on shared records (Conversation.ai, an adoption) */
  readonly id: HarnessId;
  /** as a person reads it: "Claude Code" */
  readonly name: string;
  /** whether an MCP client, by the name it gives, is this harness */
  readonly matches: (clientName: string) => boolean;
  /** where it keeps its sessions on this machine, honouring its own env override */
  readonly home: (env: NodeJS.ProcessEnv, home: string) => string;
  /** the turn and conversation of a tool call, from the call's `_meta` (and
   *  whatever the harness keeps beside it, under `home`); null when it says none */
  readonly readCall: (meta: unknown, home: string) => Effect.Effect<CallRead | null>;
  /** where the calling conversation can be reached, read from its own call;
   *  undefined when its conversation id is all a wake needs */
  readonly reachOf: Effect.Effect<string | undefined>;
  /** how a wake reaches it, for a person and an agent to read */
  readonly wakesBy: string;
  /** wake `conversation` (reached at `reach`) with one line, in the window the
   *  person is in, with `model` where waking runs one — only with steering's permit */
  readonly wake: (conversation: string, reach: string | undefined, line: string, model?: string) => Effect.Effect<Woken, never, DeliverAllowed | ChildProcessSpawner.ChildProcessSpawner>;
  /** the model each job uses when the person has not chosen one — an alias
   *  where the harness has them, so it follows the newest */
  readonly defaultModels: Partial<Record<JobKind, string>>;
  /** run a job of collagen's: a fresh, headless run of this AI with the
   *  collagen tools it needs — only with steering's permit */
  readonly runJob: (job: Job) => Effect.Effect<JobDone, never, RunAllowed | ChildProcessSpawner.ChildProcessSpawner>;
  /** its CLI, and a cheap check (no model call) that it is installed and signed in */
  readonly signIn: { readonly cmd: string; readonly args: ReadonlyArray<string>; readonly loggedIn: (out: string, exitCode: number) => boolean };
  /** what an agent in this harness does to keep hearing the room (watch-room) */
  readonly watchRecipe: (origin: string) => string;
  /** register collagen's MCP server (`name` at `url`) in its own config, so
   *  every conversation of it can call collagen */
  readonly register: (name: string, url: string, home: string) => Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem>;
  /** a conversation's session file, under `home`, or null */
  readonly transcriptOf: (conversation: string, home: string) => string | null;
  /** one line of its session log as a person reads it — null for its
   *  bookkeeping, undefined when the line is not its own */
  readonly readLine: (record: Readonly<Record<string, unknown>>, stamp: string | null) => TranscriptLine | null | undefined;
  /** a line a handed-over slice always keeps, whatever its time (a header that gives the rest its shape) */
  readonly keepsWhole: (record: Readonly<Record<string, unknown>>) => boolean;
  /** its sessions changed since `since`, and what each says of collagen's token use */
  readonly usage: {
    readonly sessions: (home: string, since: number) => Promise<ReadonlyArray<string>>;
    readonly read: (jsonl: string, file: string) => SessionCost;
  };
}

/** The harnesses in use. Everything that touches a harness gets them from
 *  here — the app from HarnessesLive, a test from its own — so nothing reaches
 *  one but through this interface. */
export class Harnesses extends Context.Service<Harnesses, ReadonlyArray<Harness>>()("cli/Harnesses") {}
/** Every harness collagen knows. */
export const HarnessesLive = Layer.succeed(Harnesses, [claudeCode, codex]);

/** The harness with id `id`, if collagen knows it. */
export const harnessFor = (harnesses: ReadonlyArray<Harness>, id: string): Harness | undefined => harnesses.find((harness) => harness.id === id);

/** The harness an MCP client is, by the name it gives. */
export const harnessOfClient = (harnesses: ReadonlyArray<Harness>, clientName: string): Harness | undefined =>
  harnesses.find((harness) => harness.matches(clientName.replace(/\s+/g, " ").trim()));

/** Where each harness keeps its sessions, by id. */
export type Homes = Readonly<Record<string, string>>;
export const homesOf = (harnesses: ReadonlyArray<Pick<Harness, "id" | "home">>, env: NodeJS.ProcessEnv = process.env, home = homedir()): Homes =>
  Object.fromEntries(harnesses.map((harness) => [harness.id, harness.home(env, home)]));

/** The session file of a conversation of harness `ai`, or null. */
export const transcriptFile = (harnesses: ReadonlyArray<Harness>, ai: string, conversation: string, homes: Homes = homesOf(harnesses)): string | null => {
  const harness = harnessFor(harnesses, ai);
  const home = harness ? homes[harness.id] : undefined;
  if (!harness || !home || conversation.length < 8 || /[/\\]/.test(conversation)) return null;
  return harness.transcriptOf(conversation, home);
};
