import { Effect, Stream, SubscriptionRef } from "effect";
import { LogBuffer } from "../../../../services/Logging";
import { McpInfo } from "../../../../services/McpInfo";
import { runtimeAtom } from "../../../../app/runtime";

// Only the footer reads these.

export const logsAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* LogBuffer).lines);
  })),
);

export const mcpUrlAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    return SubscriptionRef.changes((yield* McpInfo).url);
  })),
);
