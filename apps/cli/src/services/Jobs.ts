import { Clock, Context, Effect, Layer, Ref, Scope, SubscriptionRef } from "effect";
import { ChildProcessSpawner } from "effect/process";
import type { JobKind, OwnRun, Ticket } from "@collagen/p2p";
import { jobLimitOf, modelFor, researchPrompt } from "../lib/jobs";
import { allow, withRun } from "../lib/steering";
import { CliArgs } from "./CliArgs";
import { harnessFor, Harnesses, type Job } from "./Harness";
import { IdentityService } from "./Identity";
import { mcpServerName } from "./mcpAddress";
import { McpInfo } from "./McpInfo";
import { StateStore } from "./StateStore";

// Jobs: collagen running the person's AI for work of its own — researching
// a ticket that needs more info. Run with their preferred AI and the model
// they chose for the job, behind their steering (`run`), at most as many at
// once as they allow (one unless they say more), the rest queued in order.
// Every job shows while it waits and runs, and stays shown a while after,
// so what collagen does in their name is never out of sight.

/** A job as the person (and their agent) sees it. */
export interface JobView {
  readonly id: string;
  readonly kind: JobKind;
  readonly ticketId: string;
  readonly title: string;
  readonly harness: string;
  readonly model?: string;
  readonly state: "queued" | "running" | "done" | "failed";
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  /** what it last said, or why it failed */
  readonly note?: string;
}

/** What someone asks for: research on a ticket, with what they want to know. */
export interface ResearchAsk {
  readonly roomId: string;
  readonly ticket: Ticket;
  readonly ask?: string;
  readonly cwd: string;
}

/** How many finished jobs stay shown. */
const KEPT = 10;

export class Jobs extends Context.Service<Jobs>()("cli/Jobs", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const harnesses = yield* Harnesses;
    const mcpInfo = yield* McpInfo;
    const { profile } = yield* CliArgs;
    const { nameRef } = yield* IdentityService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // jobs outlive the call that asked for them
    const scope = yield* Scope.make();

    const views = yield* SubscriptionRef.make<ReadonlyArray<JobView>>([]);
    const waiting = yield* Ref.make<ReadonlyArray<{ readonly id: string; readonly job: Job }>>([]);

    const update = (id: string, change: (view: JobView) => JobView) =>
      SubscriptionRef.update(views, (all) => {
        const next = all.map((view) => (view.id === id ? change(view) : view));
        const finished = next.filter((view) => view.state === "done" || view.state === "failed");
        const dropped = new Set(finished.slice(0, Math.max(0, finished.length - KEPT)).map((view) => view.id));
        return next.filter((view) => !dropped.has(view.id));
      });

    /** Start what is waiting, up to the person's limit. */
    const pump: Effect.Effect<void> = Effect.gen(function* () {
      const state = yield* store.get;
      const running = (yield* SubscriptionRef.get(views)).filter((view) => view.state === "running").length;
      if (running >= jobLimitOf(state)) return;
      const next = yield* Ref.modify(waiting, (queue) => [queue[0], queue.slice(1)] as const);
      if (!next) return;
      const view = (yield* SubscriptionRef.get(views)).find((candidate) => candidate.id === next.id);
      const harness = view ? harnessFor(harnesses, view.harness) : undefined;
      const gate = allow(state, "run", "mine", true);
      if (!view || !harness || "held" in gate) {
        yield* update(next.id, (failed) => ({ ...failed, state: "failed", note: "held" in gate ? gate.why : "its AI is gone" }));
        return yield* pump;
      }
      yield* update(next.id, (started) => ({ ...started, state: "running", startedAt: Date.now() }));
      yield* Effect.forkIn(
        Effect.gen(function* () {
          const done = yield* withRun(gate.go, harness.runJob(next.job)).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
          const at = yield* Clock.currentTimeMillis;
          if (done.spent) {
            const run: OwnRun = { at, harness: harness.id, why: view.kind, ...done.spent };
            yield* store.update((now) => ({ ...now, ownRuns: [...(now.ownRuns ?? []), run].slice(-1000) }));
          }
          yield* update(next.id, (ended) => ({ ...ended, state: done.ok ? "done" : "failed", endedAt: at, ...(done.said ? { note: done.said.slice(0, 300) } : {}) }));
          yield* Effect.log(`job ${view.kind} on "${view.title}" ${done.ok ? "done" : "failed"}`);
          yield* pump;
        }),
        scope,
      );
      // another may fit under the limit
      yield* pump;
    });

    /** Queue research on a ticket, on the person's word: runs when there is
     *  room under their limit. Says what happened, or why not. */
    const research = (asked: ResearchAsk) =>
      Effect.gen(function* () {
        const state = yield* store.get;
        const harness = state.preferredAi ? harnessFor(harnesses, state.preferredAi) : undefined;
        if (!harness) return `failed: collagen runs jobs with your preferred AI, and ${state.preferredAi ? `"${state.preferredAi}" is not one it can run` : "none is set"} — choose one with set-ai (or a in the TUI)`;
        const gate = allow(state, "run", "mine", true);
        if ("held" in gate && gate.held === "unset") return `failed: ${gate.why}`;
        const url = yield* mcpInfo.awaitUrl;
        const model = modelFor(state, "research", harness.defaultModels);
        const name = mcpServerName(profile);
        const id = crypto.randomUUID();
        const title = asked.ticket.title ?? asked.ticket.goal;
        const job: Job = { prompt: researchPrompt(asked.ticket, asked.ask, yield* SubscriptionRef.get(nameRef), name), cwd: asked.cwd, server: { name, url }, ...(model ? { model } : {}) };
        const queued: JobView = { id, kind: "research", ticketId: asked.ticket.id, title, harness: harness.id, ...(model ? { model } : {}), state: "queued", queuedAt: Date.now() };
        yield* SubscriptionRef.update(views, (all) => [...all, queued]);
        yield* Ref.update(waiting, (queue) => [...queue, { id, job }]);
        yield* pump;
        const shown = (yield* SubscriptionRef.get(views)).find((view) => view.id === id);
        const ahead = (yield* Ref.get(waiting)).findIndex((queued) => queued.id === id);
        return shown?.state === "running"
          ? `research started on "${title}": ${harness.name}${model ? ` (${model})` : ""} reads it, looks into it, and posts what it found and what it needs from your user as a take on the ticket. It shows in the jobs list while it runs.`
          : `research on "${title}" is queued${ahead >= 0 ? `, ${ahead + 1} in line` : ""}: collagen runs ${jobLimitOf(state)} job${jobLimitOf(state) === 1 ? "" : "s"} at a time.`;
      });

    return { views, research } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
