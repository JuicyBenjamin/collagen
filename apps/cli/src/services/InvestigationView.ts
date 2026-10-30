import { Effect, Stream, SubscriptionRef } from "effect";
import { visibleTo } from "@collagen/p2p";
import type { InvestigationPage } from "@collagen/review-web/data";
import { investigationPage } from "../lib/investigationPage";
import { IdentityService } from "./Identity";
import { Rooms } from "./Rooms";

/** An investigation's page, from whichever of the person's rooms holds it —
 *  only one shown to them, and only an investigation — now, then each time
 *  anything on it moves (a run posts, a goal is added, a name changes): the
 *  page holds it over its socket and is drawn again from each. Null while
 *  no room here holds it. */
export const investigationView = (ticketId: string): Stream.Stream<InvestigationPage | null, never, Rooms | IdentityService> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const rooms = yield* Rooms;
      const identity = yield* IdentityService;
      const me = identity.identity.pubkey;
      const handles = yield* SubscriptionRef.get(rooms.handles);
      let handle: (typeof handles)[number] | undefined;
      for (const candidate of handles) if ((yield* SubscriptionRef.get(candidate.room.tickets)).has(ticketId)) handle = candidate;
      if (!handle) return Stream.make(null);
      const { room } = handle;
      const read = Effect.gen(function* () {
        const all = yield* SubscriptionRef.get(room.tickets);
        const ticket = all.get(ticketId);
        if (!ticket || ticket.kind !== "investigation" || !visibleTo(ticket, all, me)) return null;
        const brief = (yield* SubscriptionRef.get(room.reviews)).find((review) => review.ticketId === ticketId)?.investigation;
        const roster = yield* SubscriptionRef.get(room.roster);
        const members = yield* SubscriptionRef.get(room.members);
        const myName = yield* SubscriptionRef.get(identity.nameRef);
        const nameOf = (key: string): string => (key === me ? myName : (roster.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8)));
        return investigationPage(ticket, brief, nameOf);
      });
      // anything that might have moved it, then the page as it is now — the same page twice says nothing
      const moved: ReadonlyArray<Stream.Stream<unknown>> = [SubscriptionRef.changes(room.tickets), SubscriptionRef.changes(room.reviews), SubscriptionRef.changes(room.roster), SubscriptionRef.changes(room.members), SubscriptionRef.changes(identity.nameRef)];
      return Stream.mergeAll(moved, { concurrency: "unbounded" }).pipe(
        Stream.mapEffect(() => read),
        Stream.changesWith((before, after) => JSON.stringify(before) === JSON.stringify(after)),
      );
    }),
  );
