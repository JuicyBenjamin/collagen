import { appendFileSync } from "node:fs";
import { Config, Context, Effect, Layer, Logger, Option, SubscriptionRef } from "effect";

/** In-memory ring of recent log lines for the UI activity panel. */
export class LogBuffer extends Context.Service<LogBuffer>()("cli/LogBuffer", {
  make: Effect.gen(function* () {
    const lines = yield* SubscriptionRef.make<ReadonlyArray<string>>([]);
    // Loggers run synchronously — expose a sync append for the Logger layer,
    // running with the surrounding services captured here.
    const services = yield* Effect.context<never>();
    const appendSync = (line: string) =>
      Effect.runSyncWith(services)(SubscriptionRef.update(lines, (l) => [...l.slice(-49), line]));
    return { lines, appendSync } as const;
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
    const file = Option.getOrUndefined(yield* Config.option(Config.string("COLLAGEN_LOG")));
    const logger = Logger.make(({ date, logLevel, message, cause }) => {
      const text = Array.isArray(message) ? message.map(String).join(" ") : String(message);
      const failure = cause !== undefined && String(cause) !== "" ? ` ${String(cause).slice(0, 400)}` : "";
      const line = `${date.toISOString()} [${logLevel.toUpperCase()}] ${text}${failure}`;
      buffer.appendSync(line);
      if (file) {
        try {
          // sync on purpose: loggers must not suspend, and interleaved async
          // appends would reorder lines
          appendFileSync(file, line + "\n");
        } catch {
          // best-effort
        }
      }
    });
    return Logger.layer([logger]);
  }),
);
