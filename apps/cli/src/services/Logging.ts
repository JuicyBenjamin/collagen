import { appendFileSync } from "node:fs";
import { Config, Context, Effect, Layer, Logger, Option, SubscriptionRef } from "effect";

/** In-memory ring of recent log lines for the UI activity panel, and apart
 *  from it the recent warnings and errors, so the activity's chatter never
 *  pushes out what went wrong (room-connection reads them). */
export class LogBuffer extends Context.Service<LogBuffer>()("cli/LogBuffer", {
  make: Effect.gen(function* () {
    const lines = yield* SubscriptionRef.make<ReadonlyArray<string>>([]);
    const troubles = yield* SubscriptionRef.make<ReadonlyArray<string>>([]);
    // Loggers run synchronously — expose a sync append for the Logger layer,
    // running with the surrounding services captured here.
    const services = yield* Effect.context<never>();
    const appendSync = (line: string, trouble: boolean) =>
      Effect.runSyncWith(services)(
        Effect.andThen(
          SubscriptionRef.update(lines, (buffered) => [...buffered.slice(-49), line]),
          trouble ? SubscriptionRef.update(troubles, (buffered) => [...buffered.slice(-19), line]) : Effect.void,
        ),
      );
    return { lines, troubles, appendSync } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** Replaces the default logger: tee every log line into the UI ring buffer
 *  and, when COLLAGEN_LOG is set, append to that file (headless debugging).
 *  Nothing is written to stdout/stderr — the TUI owns the terminal. */
export const LoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const buffer = yield* LogBuffer;
    const file = Option.getOrUndefined(yield* Config.option(Config.String("COLLAGEN_LOG")));
    const logger = Logger.make(({ date, logLevel, message, cause }) => {
      const text = Array.isArray(message) ? message.map(String).join(" ") : String(message);
      const rendered = cause === undefined ? "" : String(cause);
      const failure = rendered === "" || rendered === "Cause([])" ? "" : ` ${rendered.slice(0, 400)}`;
      const line = `${date.toISOString()} [${logLevel.toUpperCase()}] ${text}${failure}`;
      // File first: it must never depend on the UI buffer succeeding. Sync on
      // purpose — loggers must not suspend, and async appends would reorder.
      const toFile = (entry: string) => {
        if (!file) return;
        try {
          appendFileSync(file, entry + "\n");
        } catch {
          // best-effort
        }
      };
      toFile(line);
      try {
        buffer.appendSync(line, logLevel === "Warn" || logLevel === "Error" || logLevel === "Fatal");
      } catch (error) {
        toFile(`${date.toISOString()} [LOGGER] ui buffer append failed: ${String(error).slice(0, 200)}`);
      }
    });
    return Logger.layer([logger]);
  }),
);
