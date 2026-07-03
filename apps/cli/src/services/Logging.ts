import { appendFileSync } from "node:fs";
import { Effect, Layer, Logger, Runtime, SubscriptionRef } from "effect";

/** In-memory ring of recent log lines for the UI activity panel. */
export class LogBuffer extends Effect.Service<LogBuffer>()("cli/LogBuffer", {
  effect: Effect.gen(function* () {
    const lines = yield* SubscriptionRef.make<ReadonlyArray<string>>([]);
    const runtime = yield* Effect.runtime<never>();
    // Loggers run synchronously — expose a sync append for the Logger layer.
    const appendSync = (line: string) =>
      Runtime.runSync(runtime)(SubscriptionRef.update(lines, (l) => [...l.slice(-49), line]));
    return { lines, appendSync } as const;
  }),
}) {}

/** Replaces the default logger: tee every log line into the UI ring buffer
 *  and, when COLLAGEN_LOG is set, append to that file (headless debugging).
 *  Nothing is written to stdout/stderr — ink owns the terminal. */
export const LoggerLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const buffer = yield* LogBuffer;
    const file = process.env["COLLAGEN_LOG"];
    const logger = Logger.make(({ date, logLevel, message }) => {
      const text = Array.isArray(message) ? message.map(String).join(" ") : String(message);
      const line = `${date.toISOString()} [${logLevel.label}] ${text}`;
      buffer.appendSync(line);
      if (file) {
        try {
          appendFileSync(file, line + "\n");
        } catch {
          // best-effort
        }
      }
    });
    return Logger.replace(Logger.defaultLogger, logger);
  }),
);
