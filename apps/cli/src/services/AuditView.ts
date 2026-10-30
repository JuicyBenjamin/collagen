import { Clock, Effect, Ref, Stream, SubscriptionRef } from "effect";
import type { AuditPage } from "@collagen/review-web/data";
import { auditPage } from "../lib/audit";
import { readSessions, type SessionCost } from "../lib/tokenCost";
import { harnessFor, Harnesses, homesOf } from "./Harness";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

const DAY = 24 * 60 * 60 * 1000;
/** How often the AIs' session logs are read again while the page is open. */
const LOGS_EVERY = "2 minutes";

/** A room's audit page over `days`, now, then each time it moves: the
 *  session logs read again every couple of minutes, the room's tickets and
 *  the person's steering as they change. Null for a room not here. */
export const auditView = (roomId: string, days: number, definitions: ReadonlyArray<{ readonly name: string; readonly chars: number }>): Stream.Stream<AuditPage | null, never, Rooms | StateStore | Harnesses> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const rooms = yield* Rooms;
      const store = yield* StateStore;
      const harnesses = yield* Harnesses;
      const handle = (yield* SubscriptionRef.get(rooms.handles)).find((candidate) => candidate.id === roomId);
      if (!handle) return Stream.make(null);
      const { room } = handle;
      const read = yield* Ref.make<{ at: number; sessions: ReadonlyArray<SessionCost> } | null>(null);
      const page = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const since = now - days * DAY;
        // the logs are the slow part: read again only when the last read is old
        const last = yield* Ref.get(read);
        const sessions = last && now - last.at < 110_000 ? last.sessions : yield* Effect.promise(() => readSessions(harnesses, homesOf(harnesses), since));
        if (!last || last.sessions !== sessions) yield* Ref.set(read, { at: now, sessions });
        const state = yield* store.get;
        const all = yield* SubscriptionRef.get(room.tickets);
        return auditPage({
          room: (yield* SubscriptionRef.get(room.meta))?.name ?? roomId.slice(0, 8),
          days,
          now,
          sessions,
          harnessName: (id) => harnessFor(harnesses, id)?.name ?? id,
          ownRuns: (state.ownRuns ?? []).filter((run) => run.at >= since),
          tickets: [...all.values()],
          reviews: yield* SubscriptionRef.get(room.reviews),
          all,
          state,
          definitions,
        });
      });
      const moved: ReadonlyArray<Stream.Stream<unknown>> = [Stream.tick(LOGS_EVERY), SubscriptionRef.changes(room.tickets), SubscriptionRef.changes(store.state)];
      return Stream.mergeAll(moved, { concurrency: "unbounded" }).pipe(
        Stream.mapEffect(() => page),
        Stream.changesWith((before, after) => JSON.stringify(before) === JSON.stringify(after)),
      );
    }),
  );
