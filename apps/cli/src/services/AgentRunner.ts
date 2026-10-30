import { homedir } from "node:os";
import { Clock, Context, Effect, Layer, Option, Ref, Semaphore, Stream, SynchronizedRef } from "effect";
import type { OwnRun } from "@collagen/p2p";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { sameName } from "../lib/names";
import { mcpServerName } from "./mcpAddress";
import { Adapters, wakeLine, type Adapter, type SpawnCtx } from "./Adapters";
import { harnessFor, Harnesses } from "./Harness";
import { CliArgs } from "./CliArgs";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";
import { allow, DeliverAllowed, levelOf, MOCK_PERMIT, STEERING_LABEL, tagRouteOf, withDeliver, type Cause } from "../lib/steering";
import { modelFor } from "../lib/jobs";
import { listenerFor } from "../lib/worked";

/** How many woken messages are remembered. */
const WOKEN = 500;
/** How many of collagen's own model runs are kept. */
const OWN_RUNS = 1000;

/** Who caused a delivery: the person's own (a message from them to them), or someone else. */
const causeOf = (spawnContext: SpawnCtx): Cause => (spawnContext.message.from === spawnContext.message.to ? "mine" : "others");

/** Delivers incoming messages to the conversation of the person's that
 *  listens for them, woken by its own harness (services/Harness) — or runs
 *  the mock; one delivery at a time per thread. */
export class AgentRunner extends Context.Service<AgentRunner>()("cli/AgentRunner", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const inbox = yield* Inbox;
    const store = yield* StateStore;
    const mcpInfo = yield* McpInfo;
    const adapters = yield* Adapters;
    const harnesses = yield* Harnesses;
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
      // each message wakes a conversation once — a restart reads the messages
      // still waiting again, and they are not news a second time
      const fresh = queued.filter((received) => !(state.woken ?? []).includes(received.message.id));
      if (fresh.length === 0) return null;
      const latest = fresh.at(-1)!;
      const news = latest.message;
      const listener = listenerFor(state, news);
      if (!listener) {
        yield* Effect.log(`→ inbox · ${about} — no conversation of yours listens for it; it waits until your agent pulls it (watch-ticket or adopt-thread links one)`);
        return null;
      }
      const cause: Cause = news.from === news.to ? "mine" : "others";
      // adopting a thread or watching a ticket is the person's yes to it; having worked on one is not
      // an investigation's findings come back to its author's conversation as their report steering says
      const kind = latest.steeredBy ?? "deliver";
      const gate = allow(state, kind, cause, listener.heard !== "worked");
      if ("held" in gate) {
        yield* Effect.log(`→ inbox · ${about} — not delivered into your conversation: ${kind === "report" ? "report" : "delivery"} steering is ${STEERING_LABEL[gate.held]}; it waits until your agent pulls it`);
        return null;
      }
      const harness = harnessFor(harnesses, listener.conversation.ai);
      if (!harness) {
        yield* Effect.log(`→ inbox · ${about} — collagen does not know how to reach a ${listener.conversation.ai} conversation; it waits until your agent pulls it`);
        return null;
      }
      const line = wakeLine({ cwd: homedir(), mcpUrl, serverName: mcpServerName(profile), message: news, sessionId: Option.some(listener.conversation.id), steering: levelOf(state, "work", cause) });
      const model = modelFor(state, "wake", harness.defaultModels);
      const woken = yield* withDeliver(gate.go, harness.wake(listener.conversation.id, listener.socket, line, model)).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
      // what collagen itself spent to wake it, kept beside what its words cost the agents
      if (woken.spent) {
        const at = yield* Clock.currentTimeMillis;
        const run: OwnRun = { at, harness: harness.id, why: "wake", ...woken.spent };
        yield* store.update((now) => ({ ...now, ownRuns: [...(now.ownRuns ?? []), run].slice(-OWN_RUNS) }));
      }
      if (!woken.reached) {
        yield* Effect.log(`→ inbox · ${about} — your ${harness.name} conversation ${listener.conversation.id.slice(0, 8)}… could not be reached from here yet; it waits until your agent pulls it`);
        return null;
      }
      yield* store.update((now) => ({ ...now, woken: [...(now.woken ?? []).filter((id) => !before.has(id)), ...before].slice(-WOKEN) }));
      yield* Effect.log(`→ ${harness.name} · ${about} — woke your conversation ${listener.conversation.id.slice(0, 8)}… in the window it is in (${harness.wakesBy})`);
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
