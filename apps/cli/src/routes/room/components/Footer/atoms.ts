import { Effect, Schedule, Stream, SubscriptionRef } from "effect";
import { troubleOf, type Trouble } from "../../../../lib/roomHealth";
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

/** What keeps the room being looked at from working, read every few
 *  seconds (the same reading room-connection gives an AI); null when nothing does. */
export const troubleAtom = runtimeAtom.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const rooms = yield* Rooms;
      const read = Effect.gen(function* () {
        const state = yield* rooms.connectionOf((yield* rooms.current).id);
        return state ? troubleOf(state) : null;
      });
      return Stream.fromEffectSchedule(read, Schedule.spaced("2 seconds")).pipe(Stream.changesWith((first: Trouble | null, second: Trouble | null) => first?.what === second?.what && first?.next === second?.next));
    }),
  ),
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
      Effect.catchTag("NotPermitted", () => Effect.succeed({ why: "your role in this room does not let you invite" } as const)),
    );
  }),
);
