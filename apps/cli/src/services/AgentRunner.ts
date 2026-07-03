import { homedir } from "node:os";
import { Effect, Option, Ref, Stream, SynchronizedRef } from "effect";
import { Command, CommandExecutor } from "@effect/platform";
import type { RoomMessage } from "@collagen/p2p";
import { mcpServerName } from "../util";
import { CliArgs } from "./CliArgs";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";

interface SpawnCtx {
  cwd: string;
  mcpUrl: string;
  serverName: string;
  msg: RoomMessage;
  sessionId: Option.Option<string>;
}

interface Adapter {
  cmd: string;
  args: (o: SpawnCtx) => string[];
  parse: (out: string) => { sessionId?: string; result?: string };
}

function nudgePrompt(o: SpawnCtx): string {
  const verb = Option.isSome(o.sessionId)
    ? "a new message arrived in this conversation"
    : "a new conversation was started";
  return `Collagen: ${verb} from ${o.msg.fromName} about "${o.msg.project}" (intent: ${o.msg.intent}). Use the ${o.serverName} get-messages tool with threadId "${o.msg.threadId}" to read it, then act on the findings in this repo.`;
}

const ADAPTERS: Record<string, Adapter> = {
  // Claude: MCP passed inline + strict so the spawn is isolated to this cli's
  // server even if others are registered. session_id in the single JSON object.
  "claude-code": {
    cmd: "claude",
    args: (o) => {
      const mcp = JSON.stringify({ mcpServers: { [o.serverName]: { type: "http", url: o.mcpUrl } } });
      const base = [
        "-p",
        nudgePrompt(o),
        "--mcp-config",
        mcp,
        "--strict-mcp-config",
        "--allowedTools",
        `mcp__${o.serverName}__*,Read,Grep,Glob`,
        "--permission-mode",
        "dontAsk",
        "--output-format",
        "json",
      ];
      return Option.isSome(o.sessionId) ? ["--resume", o.sessionId.value, ...base] : base;
    },
    parse: (out) => {
      try {
        const j = JSON.parse(out) as { session_id?: string; result?: string };
        return { sessionId: j.session_id, result: j.result };
      } catch {
        return {};
      }
    },
  },

  // Codex: MCP comes from ~/.codex/config.toml (registered at launch). `exec` is
  // non-interactive (no approvals) by design; read-only sandbox so it can only
  // observe. --json streams events; scan for the resumable thread_id.
  codex: {
    cmd: "codex",
    args: (o) => {
      const flags = [
        "--json",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        // pre-trust our MCP tools — exec mode auto-cancels approval prompts
        "-c",
        `mcp_servers.${o.serverName}.default_tools_approval_mode="approve"`,
      ];
      return Option.isSome(o.sessionId)
        ? ["exec", "resume", o.sessionId.value, ...flags, nudgePrompt(o)]
        : ["exec", ...flags, nudgePrompt(o)];
    },
    parse: (out) => {
      let sessionId: string | undefined;
      let result: string | undefined;
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as {
            type?: string;
            thread_id?: string;
            item?: { type?: string; text?: string };
          };
          if (ev.type === "thread.started" && ev.thread_id) sessionId = ev.thread_id;
          if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) {
            result = ev.item.text;
          }
        } catch {
          // non-JSON line
        }
      }
      return { sessionId, result };
    },
  },
};

/** Auto-triggers the recipient's preferred AI on incoming messages, one run at
 *  a time per thread (concurrent resumes of one session corrupt it). */
export class AgentRunner extends Effect.Service<AgentRunner>()("cli/AgentRunner", {
  effect: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const inbox = yield* Inbox;
    const store = yield* StateStore;
    const mcpInfo = yield* McpInfo;
    // Captured here so runThread's public type carries no requirements.
    const executor = yield* CommandExecutor.CommandExecutor;

    const sessions = yield* Ref.make(new Map<string, string>());
    const locks = yield* SynchronizedRef.make(new Map<string, Effect.Semaphore>());

    const lockFor = (threadId: string) =>
      SynchronizedRef.modifyEffect(locks, (m) => {
        const existing = m.get(threadId);
        if (existing) return Effect.succeed([existing, m] as const);
        return Effect.makeSemaphore(1).pipe(
          Effect.map((sem) => [sem, new Map(m).set(threadId, sem)] as const),
        );
      });

    /** Spawn the agent process, stream stderr to the log, collect stdout, and
     *  record the resumable session id. Never fails — spawn errors are logged. */
    const spawn = Effect.fn("AgentRunner.spawn")(
      function* (adapter: Adapter, ctx: SpawnCtx, threadId: string) {
        const command = Command.make(adapter.cmd, ...adapter.args(ctx)).pipe(
          Command.workingDirectory(ctx.cwd),
          Command.feed(""), // close stdin — headless agents must not wait on it
        );
        const proc = yield* Command.start(command);
        const stderrDrain = proc.stderr.pipe(
          Stream.decodeText("utf8"),
          Stream.splitLines,
          Stream.tap((line) => Effect.logWarning(`${adapter.cmd}: ${line}`)),
          Stream.runDrain,
        );
        const stdout = proc.stdout.pipe(Stream.decodeText("utf8"), Stream.mkString);
        const [out] = yield* Effect.all([stdout, stderrDrain], { concurrency: 2 });
        const exitCode = yield* proc.exitCode;
        const parsed = adapter.parse(out);
        if (parsed.sessionId !== undefined) {
          const sid = parsed.sessionId;
          yield* Ref.update(sessions, (m) => new Map(m).set(threadId, sid));
        }
        yield* Effect.log(`agent done (exit ${exitCode}): ${(parsed.result ?? "").slice(0, 160)}`);
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(CommandExecutor.CommandExecutor, executor),
          Effect.catchAll((e) => Effect.logWarning(`spawn failed: ${String(e)}`)),
        ),
    );

    /** One agent run over the thread's currently queued messages. Returns the
     *  set of message ids that were queued when the run started. */
    const runOnce = Effect.fn("AgentRunner.runOnce")(function* (threadId: string) {
      const queued = yield* inbox.peekThread(threadId);
      const sample = queued[0];
      if (!sample) return null;

      const mcpUrl = yield* mcpInfo.awaitUrl;
      const state = yield* store.get;
      const ai = state.preferredAi ?? "claude-code";
      const adapter = ADAPTERS[ai];
      if (!adapter) {
        yield* Effect.logWarning(`no spawn adapter for "${ai}" yet`);
        return null;
      }

      const proj = state.pool.find((p) => p.name === sample.project);
      const sessionId = Option.fromNullable((yield* Ref.get(sessions)).get(threadId));
      const ctx: SpawnCtx = {
        cwd: proj?.path ?? homedir(),
        mcpUrl,
        serverName: mcpServerName(profile),
        msg: sample,
        sessionId,
      };
      yield* Effect.log(
        `${Option.isSome(sessionId) ? "continue" : "start"} ${ai} · ${sample.fromName}/${sample.project}`,
      );

      const before = new Set(queued.map((m) => m.id));
      yield* spawn(adapter, ctx, threadId);
      return before;
    });

    /** Run the thread's agent now; if new messages arrived during the run,
     *  go again. Serialized per thread via its semaphore; a call that finds
     *  the lock taken returns immediately (the holder's re-check loop covers it). */
    const runThread = Effect.fn("AgentRunner.runThread")(function* (threadId: string) {
      const lock = yield* lockFor(threadId);
      yield* lock.withPermitsIfAvailable(1)(
        Effect.gen(function* () {
          let before = yield* runOnce(threadId);
          while (before !== null) {
            const queued = yield* inbox.peekThread(threadId);
            if (!queued.some((m) => !before!.has(m.id))) break;
            before = yield* runOnce(threadId);
          }
        }),
      );
    });

    return { runThread } as const;
  }),
}) {}
