import { Effect, Option, Stream, SubscriptionRef } from "effect";

/** The resolved MCP server URL, set once the HTTP server is listening.
 *  Separate tiny service so AgentRunner/Registrar/UI don't depend on the
 *  full server layer (avoids dependency cycles). */
export class McpInfo extends Effect.Service<McpInfo>()("cli/McpInfo", {
  effect: Effect.gen(function* () {
    const url = yield* SubscriptionRef.make<Option.Option<string>>(Option.none());

    /** Resolves as soon as the URL is known (immediately if already set). */
    const awaitUrl = url.changes.pipe(
      Stream.filterMap((o) => o),
      Stream.take(1),
      Stream.runHead,
      Effect.flatten,
      // changes emits the current value first and the stream never ends before
      // take(1), so None is unreachable
      Effect.orDie,
    );

    return {
      url,
      set: (u: string) => SubscriptionRef.set(url, Option.some(u)),
      awaitUrl,
    } as const;
  }),
}) {}
