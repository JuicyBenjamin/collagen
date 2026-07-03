# Effect patterns

Conventions used across the codebase, and the reasoning behind them. Useful when picking
up where we left off.

## Services are `Effect.Service` classes

Each unit of state or capability is one class:

```ts
export class Inbox extends Effect.Service<Inbox>()("cli/Inbox", {
  effect: Effect.gen(function* () {
    const buffer = yield* Ref.make<ReadonlyArray<RoomMessage>>([]);
    // … methods close over `buffer`
    return { push, take, peekThread, recent } as const;
  }),
}) {}
```

The constructor `gen` yields dependencies **once**, then returns methods that close over
them. This is why you see `Effect.gen` inside `Effect.gen`: the outer one builds the
service, the inner ones are its methods. That nesting is intentional — the alternative
(top-level functions threading every dependency as a parameter) is more code for nothing.

Scoped resources (the swarm, the HTTP server) use `scoped:` + `Effect.acquireRelease`, so
finalizers run on shutdown.

## Name deep bodies with `Effect.fn`

When a method body is long, reused, or worth seeing in a trace, extract it into a named
`Effect.fn` rather than leaving an anonymous inline `gen`:

```ts
const spawn = Effect.fn("AgentRunner.spawn")(
  function* (adapter: Adapter, ctx: SpawnCtx, threadId: string) {
    const proc = yield* Command.start(command);
    // …
  },
  // second arg: a pipe applied to the whole effect
  (effect) => effect.pipe(Effect.scoped, Effect.catchAll(/* … */)),
);
```

The string becomes a **trace span**, so errors read
`AgentRunner.runThread → AgentRunner.runOnce → AgentRunner.spawn` instead of anonymous
frames. Since observability was the reason for adopting Effect, this is the version of
"split it out" that pays off. One-liners get `Effect.withSpan(name)` instead of a full fn.

**Rule of thumb:** closure over service deps → nest, fine. Body long / reused / trace-worthy
→ extract with `Effect.fn`. Never extract just to flatten.

## Schema at every boundary

Wire frames and persisted files are `Schema` structs (`packages/p2p/src/schema.ts`,
decoded with `Schema.decodeUnknown(Schema.parseJson(...))`). Invalid input fails as a
typed `ParseError` we catch and log — it never becomes an untyped runtime surprise.

## Typed errors, not throws

Failure modes are `Data.TaggedError` (`PeerNotConnected`, `SwarmError`) and handled with
`Effect.catchTag`. The error channel is part of a function's type.

## Callback libraries → Effect

Hyperswarm is event-emitter based. We capture the runtime once
(`const runFork = Runtime.runFork(yield* Effect.runtime())`) and call `runFork(effect)`
inside each callback, so callback work runs on the service's runtime (its logger, its
scope) and feeds a `SubscriptionRef` / `PubSub`.

## UI via effect-atom

The Ink UI reads app state through [`@effect-atom/atom-react`](https://github.com/tim-smart/effect-atom).
`Atom.runtime(AppLayer)` owns the app's runtime; read atoms subscribe to
`SubscriptionRef.changes` streams; action atoms (`runtimeAtom.fn(...)`) call back into
services. Components use `useAtomValue` / `useAtomSet` and never touch Effect directly.

## MCP interop shims

Two shims in `Mcp.ts` exist because strict MCP clients (Codex's `rmcp`) reject loose
JSON-RPC framing that `@effect/rpc` emits by default:

1. **Unwrap singleton batches.** `@effect/rpc` answers a single request with a
   one-element array; we unwrap it to a bare object.
2. **`202 Accepted` for notification-only POSTs**, done in a **pre-response handler** —
   ordinary middleware sees the response only after it's already been written to the
   socket, so it can't change the status.

Plus: Codex ≥0.14x requires per-tool MCP approval and auto-cancels the prompt in `exec`
mode, so we register our server with `default_tools_approval_mode = "approve"`.
