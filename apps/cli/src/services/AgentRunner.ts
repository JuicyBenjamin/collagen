import { homedir } from "node:os";
import { Context, Effect, Layer, Option, Ref, Semaphore, Stream, SynchronizedRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { sameName } from "../lib/names";
import { mcpServerName } from "./mcpAddress";
import { Adapters, courierLine, courierPrompt, nudgePrompt, type Adapter, type SpawnCtx } from "./Adapters";
import { CliArgs } from "./CliArgs";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";
import { allow, DeliverAllowed, levelOf, MOCK_PERMIT, tagRouteOf, withDeliver, type Cause } from "../lib/steering";
import { listenerFor } from "../lib/worked";

/** Who caused a delivery: the person's own (a message from them to them), or someone else. */
const causeOf = (spawnContext: SpawnCtx): Cause => (spawnContext.message.from === spawnContext.message.to ? "mine" : "others");

/** Delivers incoming messages to the conversation of the person's that
 *  listens for them — a courier for Claude Code, codex queue for Codex — or
 *  runs the mock; one delivery at a time per thread. */
export class AgentRunner extends Context.Service<AgentRunner>()("cli/AgentRunner", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const inbox = yield* Inbox;
    const store = yield* StateStore;
    const mcpInfo = yield* McpInfo;
    const adapters = yield* Adapters;
    // Captured here so runThread's public type carries no requirements.
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const sessions = yield* Ref.make(new Map<string, string>());
    const locks = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());

    const lockFor = (threadId: string) =>
      SynchronizedRef.modifyEffect(locks, (semaphores) => {
        const existing = semaphores.get(threadId);
        if (existing) return Effect.succeed([existing, semaphores] as const);
        return Semaphore.make(1).pipe(
          Effect.map((sem) => [sem, new Map(semaphores).set(threadId, sem)] as const),
        );
      });

    /** Spawn the agent process, stream stderr to the log, collect stdout, and
     *  record the resumable session id. Never fails — spawn errors are logged. */
    const spawn = Effect.fn("AgentRunner.spawn")(
      function* (adapter: Adapter, spawnContext: SpawnCtx, threadId: string) {
        // into the person's conversation: only with steering's permit
        yield* DeliverAllowed;
        // stdin "ignore": headless agents must not wait on input. The
        // person's steering is read now, so the nudge says the current level
        const steered: SpawnCtx = { ...spawnContext, steering: levelOf(yield* store.get, "work", causeOf(spawnContext)) };
        const proc = yield* ChildProcess.make(adapter.cmd, adapter.args(steered), {
          cwd: spawnContext.cwd,
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
          yield* Ref.update(sessions, (byThread) => new Map(byThread).set(threadId, sid));
          // an adopted thread's persisted pointer follows the newest resume
          // id, so adoption survives restarts without going stale
          yield* store.update((state) =>
            state.threads?.[threadId]
              ? { ...state, threads: { ...state.threads, [threadId]: { ...state.threads[threadId]!, sessionId: sid } } }
              : state,
          );
        }
        yield* Effect.log(`agent done (exit ${exitCode}): ${(parsed.result ?? "").slice(0, 160)}`);
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.catch((error) => Effect.logWarning(`spawn failed: ${String(error)}`)),
        ),
    );

    /** Codex can receive messages natively: `codex queue` drops a nudge into
     *  the user's own thread — it surfaces at their next turn (live session)
     *  or next resume. Non-blocking, no fork, the user keeps chatting. */
    const queueNudge = Effect.fn("AgentRunner.queueNudge")(
      function* (codexThread: string, spawnContext: SpawnCtx) {
        yield* DeliverAllowed;
        const proc = yield* ChildProcess.make(
          "codex",
          ["queue", "--thread", codexThread, "--message", nudgePrompt({ ...spawnContext, steering: levelOf(yield* store.get, "work", causeOf(spawnContext)) })],
          { stdin: "ignore" },
        );
        const exit = yield* proc.exitCode;
        yield* Effect.log(`queued nudge into codex thread ${codexThread.slice(0, 8)}… (exit ${exit})`);
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.catch((error) => Effect.logWarning(`codex queue failed: ${String(error)}`)),
        ),
    );

    /** Collagen's courier: a small Claude run whose one job is to send one
     *  line, verbatim, to the person's Claude Code session through its
     *  messaging socket — which wakes it, idle or busy, in the window it is
     *  in (the desktop app's included) — and exit. Allowed SendMessage and
     *  nothing else; the line is data to it, never instructions. */
    const courier = Effect.fn("AgentRunner.courier")(
      function* (socket: string, line: string) {
        yield* DeliverAllowed;
        const proc = yield* ChildProcess.make("claude", ["-p", courierPrompt(socket, line), "--model", "haiku", "--allowedTools", "SendMessage", "--max-turns", "3"], {
          cwd: homedir(),
          stdin: "ignore",
        });
        const out = yield* proc.stdout.pipe(Stream.decodeText(), Stream.mkString);
        const exit = yield* proc.exitCode;
        yield* Effect.log(`courier to ${socket} (exit ${exit}): ${out.trim().slice(0, 160)}`);
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.timeout("2 minutes"),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.catch((error) => Effect.logWarning(`courier failed: ${String(error)}`)),
        ),
    );

    /** One delivery over the thread's currently queued messages. Returns the
     *  set of message ids that were queued when it started. */
    const runOnce = Effect.fn("AgentRunner.runOnce")(function* (threadId: string) {
      const queued = yield* inbox.peekThread(threadId);
      const first = queued[0];
      if (!first) return null;
      const { roomId, message: sample } = first;

      const mcpUrl = yield* mcpInfo.awaitUrl;
      const state = yield* store.get;
      const before = new Set(queued.map((received) => received.message.id));
      // Every line below says WHERE the delivery went, in the person's terms.
      const about = `${sample.fromName}/${sample.project}`;

      // A mock is a development dummy and the whole agent here: it answers on its own.
      const mock = state.preferredAi?.startsWith("mock") ? state.preferredAi : null;
      if (mock) {
        const adapter = adapters[mock];
        if (!adapter) {
          yield* Effect.logWarning(`no spawn adapter for "${mock}" yet`);
          return null;
        }
        const proj = (state.rooms[roomId] ?? []).find((project) => sameName(project.name, sample.project));
        const sessionId = Option.fromNullishOr((yield* Ref.get(sessions)).get(threadId) ?? state.threads?.[threadId]?.sessionId);
        yield* Effect.log(`→ ${mock} · ${about} — the mock answers on its own`);
        yield* withDeliver(MOCK_PERMIT, spawn(adapter, { cwd: proj?.path ?? homedir(), mcpUrl, serverName: mcpServerName(profile), message: sample, sessionId }, threadId));
        return before;
      }

      // A real AI is never started by an incoming message, nor run behind the
      // person's back: the message goes to the one conversation of theirs that
      // listens for it (lib/worked) — woken in the window it is in — as their
      // steering says: where a message goes (the tag route), and whether it
      // goes at all (deliver), for their own acts and for others' apart.
      if (tagRouteOf(state) === "none") {
        yield* Effect.log(`→ inbox · ${about} — your steering sends messages nowhere; it waits until your agent pulls it`);
        return null;
      }
      const listener = listenerFor(state, sample);
      if (!listener) {
        yield* Effect.log(`→ inbox · ${about} — no conversation of yours listens for it; it waits until your agent pulls it (watch-ticket or adopt-thread links one)`);
        return null;
      }
      const cause: Cause = sample.from === sample.to ? "mine" : "others";
      // adopting a thread or watching a ticket is the person's yes to it; having worked on one is not
      const gate = allow(state, "deliver", cause, listener.heard !== "worked");
      if ("held" in gate) {
        yield* Effect.log(`→ inbox · ${about} — not delivered into your conversation: ${gate.held === "unset" ? "delivery steering is not chosen" : "delivery steering is ask first"}; it waits until your agent pulls it`);
        return null;
      }
      const spawnContext: SpawnCtx = { cwd: homedir(), mcpUrl, serverName: mcpServerName(profile), message: sample, sessionId: Option.some(listener.conversation.id) };
      if (listener.conversation.ai === "codex") {
        yield* Effect.log(`→ codex queue · ${about} — into codex thread ${listener.conversation.id.slice(0, 8)}…, in its window at its next turn`);
        yield* withDeliver(gate.go, queueNudge(listener.conversation.id, spawnContext));
        return before;
      }
      if (!listener.socket) {
        yield* Effect.log(`→ inbox · ${about} — your Claude Code conversation ${listener.conversation.id.slice(0, 8)}… has not been reached from here yet; it waits until your agent pulls it`);
        return null;
      }
      yield* Effect.log(`→ courier · ${about} — a small model tells your Claude Code conversation ${listener.conversation.id.slice(0, 8)}…, in the window it is in`);
      yield* withDeliver(gate.go, courier(listener.socket, courierLine(spawnContext, levelOf(state, "work", cause))));
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
            if (!queued.some((received) => !before!.has(received.message.id))) break;
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
