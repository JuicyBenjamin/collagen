import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";

/** The resolved MCP server URL, set once the HTTP server is listening.
 *  Separate tiny service so AgentRunner/Registrar/UI don't depend on the
 *  full server layer (avoids dependency cycles). */
export class McpInfo extends Context.Service<McpInfo>()("cli/McpInfo", {
  make: Effect.gen(function* () {
    const url = yield* SubscriptionRef.make<Option.Option<string>>(Option.none());

    /** Resolves as soon as the URL is known (immediately if already set). */
    const awaitUrl = SubscriptionRef.changes(url).pipe(
      Stream.filter(Option.isSome),
      Stream.map((o) => o.value),
      Stream.take(1),
      Stream.runHead,
      // changes emits the current value first and the stream never ends before
      // take(1), so None is unreachable
      Effect.flatMap(
        Option.match({ onNone: () => Effect.die("unreachable: url stream ended"), onSome: Effect.succeed }),
      ),
    );

    return {
      url,
      set: (u: string) => SubscriptionRef.set(url, Option.some(u)),
      awaitUrl,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
