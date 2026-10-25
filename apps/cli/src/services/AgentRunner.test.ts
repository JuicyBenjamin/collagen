import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { Effect, Layer, Option, Sink, Stream, SubscriptionRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { LocalState, RoomMessage, Worked } from "@collagen/p2p";
import { Adapters, type Adapter } from "./Adapters";
import { mcpServerName } from "./mcpAddress";
import { AgentRunner } from "./AgentRunner";
import { cliArgsLayer } from "./CliArgs";
import { Inbox } from "./Inbox";
import { McpInfo } from "./McpInfo";
import { IdentityService } from "./Identity";
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
        const response = respond(call);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(response.exitCode ?? 0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stderr: Stream.empty,
          stdin: Sink.drain,
          stdout: Stream.make(new TextEncoder().encode(response.stdout)),
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
        update: (change: (s: LocalState) => LocalState) =>
          SubscriptionRef.update(state, change).pipe(Effect.asVoid),
        get: SubscriptionRef.get(state),
      };
    }),
  );

/** Fake AI adapter: args encode fresh-vs-resume so tests can assert on the
 *  session lifecycle; stdout is parsed as the {sessionId, result} JSON. */
const fakeAdapter: Adapter = {
  cmd: "fake-agent",
  auth: { args: ["status"], loggedIn: () => true },
  args: (spawnContext) => [
    Option.match(spawnContext.sessionId, { onNone: () => "fresh", onSome: (id) => `resume:${id}` }),
    spawnContext.message.threadId,
    spawnContext.mcpUrl,
    spawnContext.serverName,
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
  to: "bb".repeat(32),
  project: "sandbox",
  intent: "question",
  findings: "check average()",
  ts: 1,
  ...over,
});

const baseState: LocalState = {
  preferredAi: "mock:fake-ai",
  rooms: { testroom: [{ id: "p1", name: "sandbox", path: "/tmp/fake-project" }] },
};

const identityStub = Layer.effect(
  IdentityService,
  Effect.gen(function* () {
    const nameRef = yield* SubscriptionRef.make("tester");
    return {
      identity: {
        name: "tester",
        profile: "testprof",
        keyPair: { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(64) },
        pubkey: "aa".repeat(32),
      },
      room: { id: "testroom", name: "test room" },
      knownRooms: [{ id: "testroom", name: "test room" }],
      nameRef,
      setName: (name: string) => SubscriptionRef.set(nameRef, name),
    };
  }),
);

/** Wire AgentRunner with in-memory everything. */
const testLayer = (options: {
  state?: LocalState;
  respond?: (call: SpawnCall) => { stdout: string; exitCode?: number };
}) => {
  const exec = mockSpawner(options.respond ?? (() => ({ stdout: "{}" })));
  const layer = AgentRunner.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(Inbox.layer, McpInfo.layer)),
    Layer.provideMerge(Layer.succeed(Adapters, { "mock:fake-ai": fakeAdapter, "fake-ai": fakeAdapter })),
    Layer.provideMerge(stateStoreStub(options.state ?? baseState)),
    Layer.provideMerge(identityStub),
    Layer.provideMerge(exec.layer),
    Layer.provideMerge(cliArgsLayer({ profile: "testprof", name: Option.none(), room: Option.none() })),
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
        yield* inbox.push("testroom", message());
        yield* runner.runThread("thread-1");
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("fake-agent");
    expect(calls[0]!.args).toEqual([
      "fresh",
      "thread-1",
      "http://127.0.0.1:9/mcp",
      mcpServerName("testprof"),
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
        yield* inbox.push("testroom", message());
        yield* runner.runThread("thread-1");
        yield* inbox.push("testroom", message());
        yield* runner.runThread("thread-1");
      }),
    );
    expect(calls.map((call) => call.args[0])).toEqual(["fresh", "resume:sess-7"]);
  });

  it("keeps sessions per thread", async () => {
    const { layer, calls } = testLayer({
      respond: (call) => ({ stdout: JSON.stringify({ sessionId: `sess-for-${call.args[1]}` }) }),
    });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push("testroom", message({ threadId: "t-a" }));
        yield* runner.runThread("t-a");
        yield* inbox.push("testroom", message({ threadId: "t-b" }));
        yield* runner.runThread("t-b");
        yield* inbox.push("testroom", message({ threadId: "t-a" }));
        yield* runner.runThread("t-a");
      }),
    );
    expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
      ["fresh", "t-a"],
      ["fresh", "t-b"],
      ["resume:sess-for-t-a", "t-a"],
    ]);
  });

  // a Claude Code conversation of the person's, as collagen saw it on one of its calls
  const claude = { ai: "claude-code" as const, id: "sess-1" };
  const reached = (more: Partial<Worked> = {}): Record<string, Worked> => ({
    "claude-code:sess-1": { conversation: claude, threads: [], tickets: [], last: 1, socket: "/tmp/cc-socks/42.sock", ...more },
  });
  const delivered = async (state: LocalState, over: Partial<RoomMessage> = {}) => {
    const { layer, calls } = testLayer({ state: { ...state, preferredAi: null } });
    let left = 0;
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push("testroom", message(over));
        yield* runner.runThread("thread-1");
        left = (yield* inbox.peekThread("thread-1")).length;
      }),
    );
    return { calls, left };
  };

  it("a thread its person adopted wakes that Claude Code conversation through a courier at its socket, and the message stays to be read", async () => {
    const { calls, left } = await delivered({
      ...baseState,
      threads: { "thread-1": { ai: "claude-code", sessionId: "sess-1" } },
      worked: reached(),
      steering: { kinds: { deliver: { others: "ask" } } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("claude");
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["--model", "haiku", "--allowedTools", "SendMessage"]));
    const prompt = calls[0]!.args[1]!;
    expect(prompt).toContain('"uds:/tmp/cc-socks/42.sock"');
    expect(prompt).toContain('Collagen (not your user): alice added to a thread of yours');
    expect(prompt).not.toContain("check average()");
    expect(left).toBe(1);
  });

  it("with delivery not chosen, even an adopted conversation is not woken", async () => {
    const { calls, left } = await delivered({ ...baseState, threads: { "thread-1": { ai: "claude-code", sessionId: "sess-1" } }, worked: reached() });
    expect(calls).toHaveLength(0);
    expect(left).toBe(1);
  });

  it("at ask first, a conversation that only worked on a ticket is not woken, one its person said yes to watching it is", async () => {
    const asking: LocalState = { ...baseState, steering: { kinds: { deliver: { others: "ask" } } } };
    expect((await delivered({ ...asking, worked: reached({ tickets: ["t-1"] }) }, { ticketId: "t-1" })).calls).toHaveLength(0);
    expect((await delivered({ ...asking, worked: reached({ watching: ["t-1"] }) }, { ticketId: "t-1" })).calls).toHaveLength(1);
    // and once the person lets messages in on their own, having worked on it is enough
    expect((await delivered({ ...baseState, steering: { kinds: { deliver: { others: "act" } } }, worked: reached({ tickets: ["t-1"] }) }, { ticketId: "t-1" })).calls).toHaveLength(1);
  });

  it("a Claude Code conversation collagen has no socket for is not woken", async () => {
    const { calls } = await delivered({
      ...baseState,
      threads: { "thread-1": { ai: "claude-code", sessionId: "sess-1" } },
      steering: { kinds: { deliver: { others: "act" } } },
    });
    expect(calls).toHaveLength(0);
  });

  it("a codex-adopted thread gets the nudge queued into the user's codex session", async () => {
    const { layer, calls } = testLayer({
      state: {
        ...baseState,
        preferredAi: null,
        threads: { "thread-1": { ai: "codex", sessionId: "codex-thread-9" } },
        // the person let messages into their conversations
        steering: { kinds: { deliver: { mine: "act", others: "act" } } },
      },
    });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push("testroom", message());
        yield* runner.runThread("thread-1");
        // messages stay for the user's session to pull via get-messages
        expect(yield* inbox.peekThread("thread-1")).toHaveLength(1);
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("codex");
    expect(calls[0]!.args.slice(0, 3)).toEqual(["queue", "--thread", "codex-thread-9"]);
    expect(calls[0]!.args[4]).toContain("thread-1");
  });

  it("a mock machine never runs a real CLI, even when a thread was adopted into codex", async () => {
    // a mock peer is a whole fake agent; a stray adoption (a test, a slip) must
    // not make it spawn the real `codex` on this machine
    const { layer, calls } = testLayer({
      state: {
        ...baseState,
        preferredAi: "mock:fake-ai",
        threads: { "thread-1": { ai: "codex", sessionId: "codex-thread-9" } },
        // the person let messages into their conversations
        steering: { kinds: { deliver: { mine: "act", others: "act" } } },
      },
    });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push("testroom", message());
        yield* runner.runThread("thread-1");
      }),
    );
    expect(calls.map((call) => call.cmd)).not.toContain("codex");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe(fakeAdapter.cmd);
  });

  it("a real ai is never cold-started — first contact queues even with an adapter available", async () => {
    const { layer, calls } = testLayer({ state: { ...baseState, preferredAi: "fake-ai" } });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push("testroom", message());
        yield* runner.runThread("thread-1");
        expect(yield* inbox.peekThread("thread-1")).toHaveLength(1);
      }),
    );
    expect(calls).toHaveLength(0);
  });

  it("inbox mode: no ai set → never spawns, the message stays queued", async () => {
    const { layer, calls } = testLayer({ state: { ...baseState, preferredAi: null } });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push("testroom", message());
        yield* runner.runThread("thread-1");
        // still queued for whoever pulls via get-messages
        expect(yield* inbox.peekThread("thread-1")).toHaveLength(1);
      }),
    );
    expect(calls).toHaveLength(0);
  });

  it("does not spawn when no adapter matches the preferred ai", async () => {
    const { layer, calls } = testLayer({ state: { ...baseState, preferredAi: "unknown-ai" } });
    await run(
      layer,
      Effect.gen(function* () {
        const { inbox, runner } = yield* setup;
        yield* inbox.push("testroom", message());
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
        yield* inbox.push("testroom", message({ project: "not-in-pool" }));
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
