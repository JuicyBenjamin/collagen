import { describe, expect, it } from "vitest";
import { Deferred, Effect, Layer, Option, SubscriptionRef } from "effect";
import { ChildProcessSpawner } from "effect/process";
import type { LocalState, Ticket } from "@collagen/p2p";
import { cliArgsLayer } from "./CliArgs";
import { Harnesses, type Harness, type Job } from "./Harness";
import { IdentityService } from "./Identity";
import { Jobs } from "./Jobs";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";

const ticket = (id: string): Ticket => ({ id, project: "shop", goal: id, title: `Plan ${id}`, createdBy: "me", kind: "plan", steps: [], structureAt: 1, updatedAt: 1 });

/** A harness whose jobs finish when the test says, and that remembers what it was asked. */
const fakeHarness = (asked: Array<Job>, finish: Deferred.Deferred<void>): Harness =>
  ({
    id: "claude-code",
    name: "Claude Code",
    defaultModels: { research: "sonnet" },
    runJob: (job: Job) =>
      Effect.gen(function* () {
        asked.push(job);
        yield* Deferred.await(finish);
        return { ok: true, spent: { model: "sonnet", inputTokens: 100, outputTokens: 10, costUsd: 0.01 } };
      }),
  }) as unknown as Harness;

const setup = (state: LocalState, harness: Harness) =>
  Layer.mergeAll(
    Layer.effect(
      StateStore,
      Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(state);
        return { state: ref, get: SubscriptionRef.get(ref), update: (change: (s: LocalState) => LocalState) => SubscriptionRef.update(ref, change) } as unknown as StateStore["Service"];
      }),
    ),
    Layer.succeed(Harnesses, [harness]),
    McpInfo.layer,
    cliArgsLayer({ profile: "testprof", name: Option.none(), room: Option.none() }),
    Layer.effect(
      IdentityService,
      Effect.gen(function* () {
        return { nameRef: yield* SubscriptionRef.make("Juicy") } as unknown as IdentityService["Service"];
      }),
    ),
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {} as ChildProcessSpawner.ChildProcessSpawner["Service"]),
  );

const allowed: LocalState = { preferredAi: "claude-code", rooms: {}, steering: { kinds: { run: { mine: "ask" } } } };

/** Run `body` with a job service over a fake harness; `finish` ends its jobs. */
const withJobs = <A>(state: LocalState, asked: Array<Job>, body: (jobs: Jobs["Service"], finish: Deferred.Deferred<void>) => Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const finish = yield* Deferred.make<void>();
      return yield* Effect.gen(function* () {
        yield* (yield* McpInfo).set("http://127.0.0.1:9/mcp");
        return yield* body(yield* Jobs, finish);
      }).pipe(Effect.provide(Jobs.layer.pipe(Layer.provideMerge(setup(state, fakeHarness(asked, finish))))));
    }),
  );

const states = (jobs: Jobs["Service"]) => SubscriptionRef.get(jobs.views).pipe(Effect.map((views) => views.map((view) => `${view.title}:${view.state}`)));
const settled = (jobs: Jobs["Service"]) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 100; tries++) {
      const views = yield* SubscriptionRef.get(jobs.views);
      if (!views.some((view) => view.state === "running" || view.state === "queued")) return;
      yield* Effect.sleep("10 millis");
    }
  });

describe("jobs", () => {
  it("run one at a time by default: the second waits in line until the first is done", async () => {
    const asked: Array<Job> = [];
    const seen = await withJobs(allowed, asked, (jobs, finish) =>
      Effect.gen(function* () {
        yield* jobs.research({ roomId: "r", ticket: ticket("a"), cwd: "/tmp" });
        yield* jobs.research({ roomId: "r", ticket: ticket("b"), cwd: "/tmp" });
        const whileFirst = yield* states(jobs);
        yield* Deferred.succeed(finish, undefined);
        yield* settled(jobs);
        return { whileFirst, after: yield* states(jobs) };
      }),
    );
    expect(seen.whileFirst).toEqual(["Plan a:running", "Plan b:queued"]);
    expect(seen.after).toEqual(["Plan a:done", "Plan b:done"]);
    expect(asked.map((job) => job.model)).toEqual(["sonnet", "sonnet"]);
  });

  it("run as many at once as the person allows, with the model they chose", async () => {
    const asked: Array<Job> = [];
    const seen = await withJobs({ ...allowed, jobLimit: 2, models: { research: "opus" } }, asked, (jobs) =>
      Effect.gen(function* () {
        yield* jobs.research({ roomId: "r", ticket: ticket("a"), cwd: "/tmp" });
        yield* jobs.research({ roomId: "r", ticket: ticket("b"), cwd: "/tmp" });
        // both start, side by side
        yield* Effect.sleep("20 millis");
        return yield* states(jobs);
      }),
    );
    expect(seen).toEqual(["Plan a:running", "Plan b:running"]);
    expect(asked.map((job) => job.model)).toEqual(["opus", "opus"]);
  });

  it("run nothing while running the person's AI is not chosen in their steering", async () => {
    const asked: Array<Job> = [];
    const said = await withJobs({ ...allowed, steering: {} }, asked, (jobs) => jobs.research({ roomId: "r", ticket: ticket("a"), cwd: "/tmp" }));
    expect(said).toMatch(/^failed: steering for running your AI/);
    expect(asked).toEqual([]);
  });
});
