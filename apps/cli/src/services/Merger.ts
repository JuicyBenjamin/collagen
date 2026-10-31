import { Clock, Effect, Layer, Schedule, Semaphore, Stream, SubscriptionRef } from "effect";
import { closedAs, ticketName, type RoomMessage, type Ticket } from "@collagen/p2p";
import { hostReadiness, mergeForOf, ticketReadiness } from "../lib/merging";
import { allow, asYou, withHost, workLine, type Cause } from "../lib/steering";
import { myThreadFor } from "../lib/ticketUpdates";
import { AgentRunner } from "./AgentRunner";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { Outbox } from "./Outbox";
import { hostOf } from "./RepoHost";
import { hostLink } from "./ReviewView";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";
import { roomProjects } from "@collagen/p2p";

// Merging for the person: a review they filed whose pull request is ready —
// approved as their setting asks (lib/merging), and as its host's own rules
// ask — is merged through their own host tool, its ticket closed as done,
// and their agent told, with what the ticket said to do once it was closed
// and the tickets that wait on it, so the work queued behind it goes on by
// their steering. Only the author's own instance ever merges: it looks
// whenever a room's tickets move, and every minute while one waits on its
// host (checks running, an approval its rules want), so a review approved
// while it was away is merged when it is back. Merging is an act on the repo
// host in their name, so it waits on their steering: not chosen, it is never
// done; ask first, their agent asks them and merge-review says yes.

/** How often a review waiting on its host is looked at again. */
const EVERY = "1 minute";

export const MergerDaemon = Layer.effectDiscard(
  Effect.gen(function* () {
    const rooms = yield* Rooms;
    const store = yield* StateStore;
    const outbox = yield* Outbox;
    const inbox = yield* Inbox;
    const runner = yield* AgentRunner;
    const me = (yield* IdentityService).identity.pubkey;
    // one pass at a time: a merge is never tried twice at once
    const one = yield* Semaphore.make(1);
    // what each review was last told it waits on, so the agent hears a reason once
    const told = new Map<string, string>();

    const tell = (roomId: string, ticket: Ticket, trace: ReadonlyArray<RoomMessage>, what: string, findings: string) =>
      Effect.gen(function* () {
        const threadId = myThreadFor(ticket, trace, me, me);
        const message: RoomMessage = { id: crypto.randomUUID(), threadId, from: me, fromName: "collagen", to: me, project: ticket.project, intent: `ticket-update:${what}`, findings, ts: yield* Clock.currentTimeMillis, ticketId: ticket.id };
        yield* inbox.push(roomId, message);
        yield* Effect.forkChild(runner.runThread(threadId));
      });

    const pass = one.withPermits(1)(
      Effect.gen(function* () {
        const state = yield* store.get;
        for (const handle of yield* SubscriptionRef.get(rooms.handles)) {
          const { room } = handle;
          const tickets = yield* SubscriptionRef.get(room.tickets);
          const reviews = yield* SubscriptionRef.get(room.reviews);
          const roster = yield* SubscriptionRef.get(room.roster);
          const members = yield* SubscriptionRef.get(room.members);
          const nameOf = (key: string) => (key === me ? "you" : (roster.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8)));
          for (const ticket of tickets.values()) {
            if (ticket.kind !== "review" || ticket.createdBy !== me || closedAs(ticket) !== null) continue;
            const level = mergeForOf(state, handle.id, ticket.id);
            if (!("merge" in ticketReadiness(ticket, me, level, nameOf))) continue;
            const review = reviews.find((candidate) => candidate.ticketId === ticket.id);
            const project = roomProjects(state, handle.id).find((candidate) => candidate.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
            const link = review ? hostLink(review, project) : undefined;
            const host = link ? hostOf(link) : undefined;
            if (!review || !link || !host) continue;
            const found = yield* host.pull(link, review.branch);
            if ("none" in found) continue;
            const status = yield* host.readiness(link, found.pull.number);
            if ("none" in status) continue;
            const ready = hostReadiness(status.pull, host.name);
            const trace = yield* SubscriptionRef.get(room.trace);
            if ("waiting" in ready) {
              // said once per reason: why it is approved here and not merged yet
              if (told.get(ticket.id) !== ready.waiting) {
                told.set(ticket.id, ready.waiting);
                yield* tell(handle.id, ticket, trace, "not merged yet", `"${ticketName(ticket)}" (${ticket.id}) is approved as your user asked, and collagen will merge #${found.pull.number} for them once ${host.name} lets it: ${ready.waiting}. Tell your user in one line; nothing to do.`);
              }
              continue;
            }
            // someone else's approval merging it is their doing; the person's own Accept, theirs
            const cause: Cause = level === "theirs" ? "others" : "mine";
            const gate = allow(state, "host", cause, (state.mergeYes ?? []).includes(ticket.id), handle.id);
            if ("merge" in ready && "held" in gate) {
              const why =
                gate.held !== "ask"
                  ? `"${ticketName(ticket)}" (${ticket.id}) is approved as your user asked and #${found.pull.number} is ready, but collagen merges nothing on ${host.name} in their name: ${gate.why}. Tell your user in one line.`
                  : `"${ticketName(ticket)}" (${ticket.id}) is approved as your user asked and #${found.pull.number} is ready to merge. Their repo-host steering is ask first: ask them whether collagen should merge it on ${host.name} as them, through their own gh. On their yes, call merge-review {ticketId: "${ticket.id}"}.`;
              if (told.get(ticket.id) !== why) {
                told.set(ticket.id, why);
                yield* tell(handle.id, ticket, trace, gate.held !== "ask" ? "not merged" : "ready to merge", why);
              }
              continue;
            }
            // merged by hand meanwhile: its work landed all the same
            const merged = "merge" in ready && "go" in gate ? yield* withHost(gate.go, host.merge(link, found.pull.number)) : { ok: true as const };
            if ("error" in merged) {
              if (told.get(ticket.id) !== merged.error) {
                told.set(ticket.id, merged.error);
                yield* tell(handle.id, ticket, trace, "not merged", `Collagen could not merge #${found.pull.number} for "${ticketName(ticket)}" (${ticket.id}): ${merged.error}. Tell your user in one line.`);
              }
              continue;
            }
            told.delete(ticket.id);
            yield* store.update((now) => ({ ...now, mergeYes: (now.mergeYes ?? []).filter((id) => id !== ticket.id) }));
            const closed = yield* outbox.tell({ roomId: handle.id, to: "the room", title: `${ticket.goal} · merged and closed`, outgoing: { kind: "close", ticketId: ticket.id, outcome: "done", reason: `merged as #${found.pull.number}` } });
            const waiting = [...tickets.values()].filter((other) => closedAs(other) === null && ((other.after ?? []).includes(ticket.id) || (other.from ?? []).includes(ticket.id)));
            const next = waiting.length > 0 ? ` Waiting on it: ${waiting.map((other) => `"${ticketName(other)}" (${other.id})`).join(", ")} — the work queued behind it can go on.` : "";
            yield* tell(
              handle.id,
              ticket,
              trace,
              "merged",
              `Collagen merged ${found.pull.url} for your user${"go" in gate ? `, ${asYou(gate.go, "gh")}` : ""} — "${ticketName(ticket)}" was approved as they asked (${level === "theirs" ? "someone else approved it" : level === "mine" ? "they accepted it" : "someone else approved it and they accepted it"}). ${closed}${next} ${workLine(yield* store.get, "mine")}`,
            );
          }
        }
      }),
    );

    // whenever any room's tickets move, and every minute for what waits on its host
    const moved = SubscriptionRef.changes(rooms.handles).pipe(
      Stream.switchMap((handles: ReadonlyArray<{ readonly room: { readonly tickets: SubscriptionRef.SubscriptionRef<ReadonlyMap<string, Ticket>> } }>) =>
        Stream.mergeAll(handles.map((handle) => SubscriptionRef.changes(handle.room.tickets)), { concurrency: "unbounded" }),
      ),
    );
    yield* moved.pipe(Stream.debounce("2 seconds"), Stream.runForEach(() => Effect.ignore(pass)), Effect.forkScoped);
    // and as soon as the person says yes to merging one
    yield* SubscriptionRef.changes(store.state).pipe(
      Stream.map((state) => (state.mergeYes ?? []).join(" ")),
      Stream.changes,
      Stream.drop(1),
      Stream.runForEach(() => Effect.ignore(pass)),
      Effect.forkScoped,
    );
    yield* Effect.ignore(pass).pipe(Effect.repeat(Schedule.spaced(EVERY)), Effect.forkScoped);
  }),
);
