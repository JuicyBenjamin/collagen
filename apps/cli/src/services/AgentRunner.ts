import { homedir } from "node:os";
import { Effect, Option, Ref, Stream, SynchronizedRef } from "effect";
import { Command, CommandExecutor } from "@effect/platform";
import { mcpServerName } from "../util";
import { Adapters, type Adapter, type SpawnCtx } from "./Adapters";
import { CliArgs } from "./CliArgs";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";

/** Auto-triggers the recipient's preferred AI on incoming messages, one run at
 *  a time per thread (concurrent resumes of one session corrupt it). */
export class AgentRunner extends Effect.Service<AgentRunner>()("cli/AgentRunner", {
  effect: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const inbox = yield* Inbox;
    const store = yield* StateStore;
    const mcpInfo = yield* McpInfo;
    const adapters = yield* Adapters;
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
      const adapter = adapters[ai];
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
