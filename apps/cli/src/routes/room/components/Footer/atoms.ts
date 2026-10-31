import { Effect, Stream, SubscriptionRef } from "effect";
import { LogBuffer } from "../../../../services/Logging";
import { McpInfo } from "../../../../services/McpInfo";
import { Rooms } from "../../../../services/Rooms";
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

/** A new invite to the room being looked at — c copies it. It lets one
 *  person in, within a week; the text, or why the room cannot invite yet. */
export const inviteAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* () {
    const { room } = yield* (yield* Rooms).current;
    return yield* room.createInvite().pipe(
      Effect.map((invite) => ({ invite }) as const),
      Effect.catchTag("NotWritable", () => Effect.succeed({ why: "not let in to write yet, or still moving to its encrypted log — try again in a moment" } as const)),
    );
  }),
);
