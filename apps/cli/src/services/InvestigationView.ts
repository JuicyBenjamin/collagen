import { homedir } from "node:os";
import { Clock, Effect, Stream, SubscriptionRef } from "effect";
import { closedAs, emptyReview, goalsOf, mergeReview, QUESTION_GOAL, roomProjects, visibleTo } from "@collagen/p2p";
import type { HostWrite, InvestigationPage } from "@collagen/review-web/data";
import { sameName } from "../lib/names";
import { Jobs } from "./Jobs";
import { Outbox } from "./Outbox";
import { StateStore } from "./StateStore";
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
        return investigationPage(ticket, brief, nameOf, me);
      });
      // anything that might have moved it, then the page as it is now — the same page twice says nothing
      const moved: ReadonlyArray<Stream.Stream<unknown>> = [SubscriptionRef.changes(room.tickets), SubscriptionRef.changes(room.reviews), SubscriptionRef.changes(room.roster), SubscriptionRef.changes(room.members), SubscriptionRef.changes(identity.nameRef)];
      return Stream.mergeAll(moved, { concurrency: "unbounded" }).pipe(
        Stream.mapEffect(() => read),
        Stream.changesWith((before, after) => JSON.stringify(before) === JSON.stringify(after)),
      );
    }),
  );

/** The author's answer to a run's question on their investigation. A yes to
 *  one that carries a follow-up adds it as a goal under the same group and
 *  starts their AI on it — the yes is their word for it; a no only records
 *  the answer. The page's buttons and answer-question are this one act. */
export const answerQuestion = Effect.fn("InvestigationView.answer")(function* (ticketId: string, questionId: string, answer: "yes" | "no") {
  const rooms = yield* Rooms;
  const me = (yield* IdentityService).identity.pubkey;
  const myName = yield* SubscriptionRef.get((yield* IdentityService).nameRef);
  for (const handle of yield* SubscriptionRef.get(rooms.handles)) {
    const all = yield* SubscriptionRef.get(handle.room.tickets);
    const ticket = all.get(ticketId);
    if (!ticket) continue;
    if (ticket.kind !== "investigation" || !visibleTo(ticket, all, me)) return { error: `no investigation ${ticketId} in your rooms` } satisfies HostWrite;
    if (ticket.createdBy !== me) return { error: "only the investigation's author answers its questions" } satisfies HostWrite;
    if (closedAs(ticket) !== null) return { error: "the investigation is closed" } satisfies HostWrite;
    const asked = ticket.steps.flatMap((step) => (step.answers ?? []).flatMap((goalAnswer) => (goalAnswer.questions ?? []).flatMap((question) => (typeof question === "string" ? [] : [{ question, goal: goalAnswer.goal }])))).find(({ question }) => question.id === questionId);
    if (!asked) return { error: `no question ${questionId} on this investigation` } satisfies HostWrite;
    const now = yield* Clock.currentTimeMillis;
    const base = (yield* SubscriptionRef.get(handle.room.reviews)).find((review) => review.ticketId === ticketId) ?? emptyReview(ticketId, me, myName);
    if (base.investigation?.decided?.some((had) => had.question === questionId)) return { error: "that question is answered already" } satisfies HostWrite;
    // a yes that leads somewhere: its follow-up becomes a goal beside the one it came from
    const follow = answer === "yes" ? asked.question.then : undefined;
    const from = goalsOf(base.investigation ?? { question: ticket.goal }).find((goal) => goal.id === asked.goal);
    const grown = follow ? mergeReview(base, { investigation: { goals: [{ ask: follow.ask, ...(follow.title ? { title: follow.title } : {}), ...(from?.group ? { group: from.group } : {}) }] } }, now) : base;
    const added = goalsOf(grown.investigation ?? { question: ticket.goal }).find((goal) => !(base.investigation?.goals ?? []).some((had) => had.id === goal.id) && goal.id !== QUESTION_GOAL);
    const review = mergeReview(grown, { investigation: { decided: [{ question: questionId, answer, ...(added ? { goal: added.id } : {}) }] } }, now);
    const told = yield* (yield* Outbox).tell({ roomId: handle.id, to: "the room", title: `${ticket.title ?? ticket.goal} · answered a question`, outgoing: { kind: "review", review } });
    if (told.startsWith("failed")) return { error: told.replace(/^failed: /, "") } satisfies HostWrite;
    if (added && review.investigation) {
      const project = roomProjects(yield* (yield* StateStore).get, handle.id).find((candidate) => sameName(candidate.name, ticket.project));
      const said = yield* (yield* Jobs).research({ roomId: handle.id, ticket, cwd: project?.path ?? homedir(), investigation: { brief: review.investigation }, goals: [added.id] });
      if (said.startsWith("failed")) return { error: `answered, but the follow-up did not start: ${said.replace(/^failed: /, "")}` } satisfies HostWrite;
    }
    return { ok: true as const } satisfies HostWrite;
  }
  return { error: `no investigation ${ticketId} in your rooms` } satisfies HostWrite;
});
