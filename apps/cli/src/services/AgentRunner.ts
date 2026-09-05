import { homedir } from "node:os";
import { Context, Effect, Layer, Option, Ref, Semaphore, Stream, SynchronizedRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { mcpServerName } from "../util";
import { Adapters, nudgePrompt, type Adapter, type SpawnCtx } from "./Adapters";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";

/** Auto-triggers the recipient's preferred AI on incoming messages, one run at
 *  a time per thread (concurrent resumes of one session corrupt it). */
export class AgentRunner extends Context.Service<AgentRunner>()("cli/AgentRunner", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const { room } = yield* IdentityService;
    const inbox = yield* Inbox;
    const store = yield* StateStore;
    const mcpInfo = yield* McpInfo;
    const adapters = yield* Adapters;
    // Captured here so runThread's public type carries no requirements.
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const sessions = yield* Ref.make(new Map<string, string>());
    const locks = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());

    const lockFor = (threadId: string) =>
      SynchronizedRef.modifyEffect(locks, (m) => {
        const existing = m.get(threadId);
        if (existing) return Effect.succeed([existing, m] as const);
        return Semaphore.make(1).pipe(
          Effect.map((sem) => [sem, new Map(m).set(threadId, sem)] as const),
        );
      });

    /** Spawn the agent process, stream stderr to the log, collect stdout, and
     *  record the resumable session id. Never fails — spawn errors are logged. */
    const spawn = Effect.fn("AgentRunner.spawn")(
      function* (adapter: Adapter, ctx: SpawnCtx, threadId: string) {
        // stdin "ignore": headless agents must not wait on input
        const proc = yield* ChildProcess.make(adapter.cmd, adapter.args(ctx), {
          cwd: ctx.cwd,
          stdin: "ignore",
        });
        const stderrDrain = proc.stderr.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.tap((line) => Effect.logWarning(`${adapter.cmd}: ${line}`)),
          Stream.runDrain,
        );
        const stdout = proc.stdout.pipe(Stream.decodeText(), Stream.mkString);
        const [out] = yield* Effect.all([stdout, stderrDrain], { concurrency: 2 });
        const exitCode = yield* proc.exitCode;
        const parsed = adapter.parse(out);
        if (parsed.sessionId !== undefined) {
          const sid = parsed.sessionId;
          yield* Ref.update(sessions, (m) => new Map(m).set(threadId, sid));
          // an adopted thread's persisted pointer follows the newest resume
          // id, so adoption survives restarts without going stale
          yield* store.update((s) =>
            s.threads?.[threadId]
              ? { ...s, threads: { ...s.threads, [threadId]: { ...s.threads[threadId]!, sessionId: sid } } }
              : s,
          );
        }
        yield* Effect.log(`agent done (exit ${exitCode}): ${(parsed.result ?? "").slice(0, 160)}`);
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.catch((e) => Effect.logWarning(`spawn failed: ${String(e)}`)),
        ),
    );

    /** Codex can receive messages natively: `codex queue` drops a nudge into
     *  the user's own thread — it surfaces at their next turn (live session)
     *  or next resume. Non-blocking, no fork, the user keeps chatting. */
    const queueNudge = Effect.fn("AgentRunner.queueNudge")(
      function* (codexThread: string, ctx: SpawnCtx) {
        const proc = yield* ChildProcess.make(
          "codex",
          ["queue", "--thread", codexThread, "--message", nudgePrompt(ctx)],
          { stdin: "ignore" },
        );
        const exit = yield* proc.exitCode;
        yield* Effect.log(`queued nudge into codex thread ${codexThread.slice(0, 8)}… (exit ${exit})`);
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.catch((e) => Effect.logWarning(`codex queue failed: ${String(e)}`)),
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
      // An adopted thread resumes the USER'S own conversation (registered
      // via the adopt-thread tool) with the CLI that owns it; the in-memory
      // map tracks the freshest resume id within this process.
      const adopted = state.threads?.[threadId];
      const ai = adopted?.ai ?? state.preferredAi;
      const sessionId = Option.fromNullishOr(
        (yield* Ref.get(sessions)).get(threadId) ?? adopted?.sessionId,
      );

      // A real AI is never cold-started by an incoming message — spawning
      // invisible conversations behind the user is exactly what we don't
      // want (and the CLI may not even exist). It only resumes a thread
      // that already has a conversation (an adoption, or a session it
      // started itself). Everything else queues in the inbox for the user's
      // own session to pull — and adopt. Mocks are test dummies and always
      // auto-respond.
      const isMock = ai !== null && ai !== undefined && ai.startsWith("mock");
      if (ai === null || ai === undefined || (!isMock && Option.isNone(sessionId))) {
        yield* Effect.log(
          `message queued (${ai == null ? "no ai set" : "no conversation for this thread yet"}): ${sample.fromName}/${sample.project}`,
        );
        return null;
      }
      // codex-adopted threads get the message pushed INTO the user's session
      // instead of us spawning anything.
      if (!isMock && adopted?.ai === "codex") {
        const ctx: SpawnCtx = {
          cwd: homedir(),
          mcpUrl,
          serverName: mcpServerName(profile),
          msg: sample,
          sessionId: Option.some(adopted.sessionId),
        };
        yield* Effect.log(`queue → codex · ${sample.fromName}/${sample.project}`);
        yield* queueNudge(adopted.sessionId, ctx);
        return new Set(queued.map((m) => m.id));
      }

      const adapter = adapters[ai];
      if (!adapter) {
        yield* Effect.logWarning(`no spawn adapter for "${ai}" yet`);
        return null;
      }

      const proj = (state.rooms[room.id] ?? []).find((p) => p.name === sample.project);
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
      yield* Semaphore.withPermitsIfAvailable(lock, 1)(
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
}) {
  static readonly layer = Layer.effect(this, this.make);
}
