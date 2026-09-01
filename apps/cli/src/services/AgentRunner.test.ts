import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { Effect, Layer, Option, Sink, Stream, SubscriptionRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { LocalState, RoomMessage } from "@collagen/p2p";
import { Adapters, type Adapter } from "./Adapters";
import { AgentRunner } from "./AgentRunner";
import { cliArgsLayer } from "./CliArgs";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";

/** One recorded subprocess spawn: what AgentRunner asked the spawner to run. */
interface SpawnCall {
  cmd: string;
  args: ReadonlyArray<string>;
  cwd: string | undefined;
}

/** In-memory ChildProcessSpawner: records each spawn and replies with scripted
 *  stdout instead of exec'ing anything. The AI boundary in this app is process
 *  spawn, so this is the seam tests mock. */
const mockSpawner = (respond: (call: SpawnCall) => { stdout: string; exitCode?: number }) => {
  const calls: SpawnCall[] = [];
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const std = command as ChildProcess.StandardCommand;
        const call: SpawnCall = { cmd: std.command, args: std.args, cwd: std.options.cwd };
        calls.push(call);
        const res = respond(call);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(res.exitCode ?? 0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stderr: Stream.empty,
          stdin: Sink.drain,
          stdout: Stream.make(new TextEncoder().encode(res.stdout)),
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.die("unref unused in tests") as never,
        });
      }),
    ),
  );
  return { calls, layer };
};

/** StateStore backed by a plain SubscriptionRef — no filesystem. */
const stateStoreStub = (initial: LocalState) =>
  Layer.effect(
    StateStore,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make(initial);
      return {
        state,
        update: (f: (s: LocalState) => LocalState) =>
          SubscriptionRef.update(state, f).pipe(Effect.asVoid),
        get: SubscriptionRef.get(state),
      };
    }),
  );

/** Fake AI adapter: args encode fresh-vs-resume so tests can assert on the
 *  session lifecycle; stdout is parsed as the {sessionId, result} JSON. */
const fakeAdapter: Adapter = {
  cmd: "fake-agent",
  args: (o) => [
    Option.match(o.sessionId, { onNone: () => "fresh", onSome: (id) => `resume:${id}` }),
    o.msg.threadId,
    o.mcpUrl,
    o.serverName,
  ],
  parse: (out) => {
    try {
      return JSON.parse(out) as { sessionId?: string; result?: string };
    } catch {
      return {};
    }
  },
};

const message = (over: Partial<RoomMessage> = {}): RoomMessage => ({
  id: `m-${Math.random().toString(36).slice(2)}`,
  threadId: "thread-1",
  from: "aa".repeat(32),
  fromName: "alice",
  project: "sandbox",
  intent: "question",
  findings: "check average()",
  ts: 1,
  ...over,
});

const baseState: LocalState = {
  preferredAi: "fake-ai",
  pool: [{ id: "p1", name: "sandbox", path: "/tmp/fake-project" }],
  rooms: {},
};

/** Wire AgentRunner with in-memory everything. */
const testLayer = (opts: {
  state?: LocalState;
  respond?: (call: SpawnCall) => { stdout: string; exitCode?: number };
}) => {
  const exec = mockSpawner(opts.respond ?? (() => ({ stdout: "{}" })));
  const layer = AgentRunner.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(Inbox.layer, McpInfo.layer)),
    Layer.provideMerge(Layer.succeed(Adapters, { "fake-ai": fakeAdapter })),
    Layer.provideMerge(stateStoreStub(opts.state ?? baseState)),
    Layer.provideMerge(exec.layer),
    Layer.provideMerge(cliArgsLayer({ profile: "testprof", name: Option.none() })),
  );
  return { layer, calls: exec.calls };
};

const run = <A>(
  layer: Layer.Layer<AgentRunner | Inbox | McpInfo>,
  body: Effect.Effect<A, unknown, unknown>,
) => Effect.runPromise(body.pipe(Effect.provide(layer as Layer.Layer<never>)) as Effect.Effect<A>);

const setup = Effect.gen(function* () {
  const inbox = yield* Inbox;
  const runner = yield* AgentRunner;
  yield* (yield* McpInfo).set("http://127.0.0.1:9/mcp");
  return { inbox, runner };
});

describe("AgentRunner", () => {
  it("spawns the preferred adapter in the project's cwd with the thread context", async () => {
    const { layer, calls } = testLayer({});
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push(message());
        yield* runner.runThread("thread-1");
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("fake-agent");
    expect(calls[0]!.args).toEqual([
      "fresh",
      "thread-1",
      "http://127.0.0.1:9/mcp",
      "collagen-testprof",
    ]);
    expect(calls[0]!.cwd).toBe("/tmp/fake-project");
  });

  it("records the session id and resumes the thread on the next run", async () => {
    const { layer, calls } = testLayer({
      respond: () => ({ stdout: JSON.stringify({ sessionId: "sess-7", result: "ok" }) }),
    });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push(message());
        yield* runner.runThread("thread-1");
        yield* inbox.push(message());
        yield* runner.runThread("thread-1");
      }),
    );
    expect(calls.map((c) => c.args[0])).toEqual(["fresh", "resume:sess-7"]);
  });

  it("keeps sessions per thread", async () => {
    const { layer, calls } = testLayer({
      respond: (c) => ({ stdout: JSON.stringify({ sessionId: `sess-for-${c.args[1]}` }) }),
    });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push(message({ threadId: "t-a" }));
        yield* runner.runThread("t-a");
        yield* inbox.push(message({ threadId: "t-b" }));
        yield* runner.runThread("t-b");
        yield* inbox.push(message({ threadId: "t-a" }));
        yield* runner.runThread("t-a");
      }),
    );
    expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
      ["fresh", "t-a"],
      ["fresh", "t-b"],
      ["resume:sess-for-t-a", "t-a"],
    ]);
  });

  it("does not spawn when no adapter matches the preferred ai", async () => {
    const { layer, calls } = testLayer({ state: { ...baseState, preferredAi: "unknown-ai" } });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push(message());
        yield* runner.runThread("thread-1");
      }),
    );
    expect(calls).toHaveLength(0);
  });

  it("falls back to the home directory for messages about unknown projects", async () => {
    const { layer, calls } = testLayer({});
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push(message({ project: "not-in-pool" }));
        yield* runner.runThread("thread-1");
      }),
    );
    expect(calls[0]!.cwd).toBe(homedir());
  });

  it("does nothing for a thread with no queued messages", async () => {
    const { layer, calls } = testLayer({});
    await run(
      layer,
      Effect.gen(function* () {
        const { runner } = yield* setup;
        yield* runner.runThread("empty-thread");
      }),
    );
    expect(calls).toHaveLength(0);
  });
});
