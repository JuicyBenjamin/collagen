import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { roomProjects, type Preparing, type RoomMessage, type Ticket } from "@collagen/p2p";
import { levelOf } from "../lib/steering";
import { sameName } from "../lib/names";
import { notesOf } from "../lib/steeringNotes";
import { appliesTo } from "@collagen/p2p";
import { AgentRunner } from "./AgentRunner";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { Jobs } from "./Jobs";
import { Rooms } from "./Rooms";
import { StateStore } from "./StateStore";

// A review the person files is prepared before anyone else reads it, as
// their guidance steering allows: a narrow, cheap pass checks the change
// against the steering notes that apply to its files; what falls short goes
// to the conversation that built the work to fix (as their work steering
// allows), and the pass runs again — three rounds at most. While it is
// prepared its ticket is marked preparing, so the room's one gate hides it
// from everyone but its author and holds back every reader's step; once it
// passes the mark comes off and it reaches them at once.

/** The most rounds a review is prepared for: then it stops and asks the person. */
export const ROUNDS = 3;

/** What fell short of a note: which, where, what. */
export interface Shortfall {
  readonly note: string;
  readonly where?: string;
  readonly what: string;
}

/** The files a review's why names, its parts' places without their lines. */
export const filesOfWhy = (why: { readonly decisions: ReadonlyArray<{ readonly where: ReadonlyArray<string> }>; readonly units?: ReadonlyArray<{ readonly where: ReadonlyArray<string> }> }): ReadonlyArray<string> => [
  ...new Set([...why.decisions, ...(why.units ?? [])].flatMap((part) => part.where).map((place) => place.replace(/:[\d,\-–]+$/, ""))),
];

export class GuidancePass extends Context.Service<GuidancePass>()("cli/GuidancePass", {
  make: Effect.gen(function* () {
    const store = yield* StateStore;
    const rooms = yield* Rooms;
    const jobs = yield* Jobs;
    const inbox = yield* Inbox;
    const runner = yield* AgentRunner;
    const { identity, nameRef } = yield* IdentityService;
    const me = identity.pubkey;

    const handleOf = (roomId: string) => SubscriptionRef.get(rooms.handles).pipe(Effect.map((all) => all.find((handle) => handle.id === roomId)));

    /** The review, its why, the notes that apply to it, and its project's folder here. */
    const reviewOf = (roomId: string, ticketId: string) =>
      Effect.gen(function* () {
        const handle = yield* handleOf(roomId);
        if (!handle) return null;
        const ticket = (yield* SubscriptionRef.get(handle.room.tickets)).get(ticketId);
        const why = (yield* SubscriptionRef.get(handle.room.reviews)).find((candidate) => candidate.ticketId === ticketId);
        if (!ticket || !why || ticket.createdBy !== me) return null;
        const files = filesOfWhy(why);
        const notes = notesOf(yield* SubscriptionRef.get(handle.room.notes), yield* SubscriptionRef.get(handle.room.noteTurns), ticket.project).filter(
          (now) => !now.retired && (!now.words.where || now.words.where.length === 0 || files.some((file) => appliesTo(now.words.where, file))),
        );
        const path = roomProjects(yield* store.get, roomId).find((candidate) => sameName(candidate.name, ticket.project))?.path ?? null;
        return { handle, ticket, why, notes, path };
      });

    /** The ticket's preparing mark set or taken off: the author's own structure, a revision of their clock. */
    const mark = (roomId: string, ticket: Ticket, preparing: boolean) =>
      Effect.gen(function* () {
        const handle = yield* handleOf(roomId);
        if (!handle) return;
        const now = yield* Clock.currentTimeMillis;
        yield* handle.room
          .shareTicket({ ...ticket, preparing, structureAt: Math.max(now, ticket.structureAt + 1), updatedAt: now })
          .pipe(Effect.catchTag("NotWritable", () => Effect.logWarning("cannot mark the review: not admitted to the room log")));
      });

    const keep = (ticketId: string, preparing: Preparing | null) =>
      store.update((state) => {
        const { [ticketId]: _was, ...rest } = state.preparing ?? {};
        return { ...state, preparing: preparing ? { ...rest, [ticketId]: preparing } : rest };
      });

    /** Where the pass talks to the person: a thread of its own, held by the conversation that built the work. */
    const threadOf = (ticketId: string) => `guidance-${ticketId}`;
    const tellBuilder = (roomId: string, ticket: Ticket, intent: string, findings: string) =>
      Effect.gen(function* () {
        const builder = ticket.conversation;
        if (!builder) return false;
        const threadId = threadOf(ticket.id);
        yield* store.update((now) => ({ ...now, threads: { ...now.threads, [threadId]: { ai: builder.ai, sessionId: builder.id, since: now.threads?.[threadId]?.since ?? Date.now() } } }));
        const myName = yield* SubscriptionRef.get(nameRef);
        const message: RoomMessage = { id: crypto.randomUUID(), threadId, from: me, fromName: myName, to: me, project: ticket.project, intent, findings, ts: yield* Clock.currentTimeMillis, ticketId: ticket.id };
        yield* inbox.push(roomId, message);
        yield* Effect.forkChild(runner.runThread(threadId));
        return true;
      });

    /** One pass: a job reads the change and the notes, and says (guidance-pass report) what it found. */
    const check = (roomId: string, ticketId: string, round: number) =>
      Effect.gen(function* () {
        const found = yield* reviewOf(roomId, ticketId);
        if (!found) return "failed: no review of your user's by that id";
        if (found.notes.length === 0) return yield* open(roomId, ticketId, "no steering note applies to it");
        const { ticket, why, notes } = found;
        const range = why.branch ? `${why.base ?? "main"}...${why.branch}` : "the working tree";
        const prompt = [
          `You are a guidance pass collagen runs for your user before anyone else reads their review "${ticket.title ?? ticket.goal}" (ticket ${ticket.id}), round ${round} of ${ROUNDS}.`,
          `Check ONLY this: does the change follow each steering note below — how the people in this room want things done here? Not whether the change is right; that is the reviewers'. Read the change with \`git diff ${range}\` and the files it touches.`,
          `The notes (get-note reads one whole if you need more):`,
          ...notes.map((now) => `- ${now.note.id}: ${now.words.title}${now.words.strength ? ` [${now.words.strength}]` : ""}\n  ${now.words.description.replace(/\n+/g, "\n  ")}`),
          `Then call guidance-pass once: action "report", ticketId "${ticket.id}", round ${round}, passed true when every note is followed, else passed false with 'findings': each place it falls short — the note's id, where (file:line) and what to change, in a line. Nothing else.`,
        ].join("\n");
        yield* keep(ticketId, { roomId, round, stage: "checking", at: yield* Clock.currentTimeMillis });
        const said = yield* jobs.file({ roomId, requestId: ticketId, title: `guidance pass on "${ticket.title ?? ticket.goal}" (round ${round})`, prompt, cwd: found.path ?? process.cwd(), reads: [] }, "guidance");
        if (said.startsWith("failed")) {
          // nothing can check it here: it is not held back for that
          yield* open(roomId, ticketId, `the pass could not run: ${said.replace(/^failed: /, "")}`);
          return said;
        }
        return `being prepared: its guidance pass checks it against ${notes.length} steering note${notes.length === 1 ? "" : "s"} first (round ${round} of ${ROUNDS}); nobody else sees it until it passes.`;
      });

    /** Open it to its readers: the mark comes off, the person is told as their steering says. */
    const open = (roomId: string, ticketId: string, how: string) =>
      Effect.gen(function* () {
        const handle = yield* handleOf(roomId);
        const ticket = handle ? (yield* SubscriptionRef.get(handle.room.tickets)).get(ticketId) : undefined;
        const kept = (yield* store.get).preparing?.[ticketId];
        yield* keep(ticketId, null);
        if (!ticket) return "failed: that review is gone";
        if (ticket.preparing) yield* mark(roomId, ticket, false);
        const level = levelOf(yield* store.get, "guidance", "mine", roomId);
        const rounds = kept ? ` after ${kept.round} round${kept.round === 1 ? "" : "s"}` : "";
        if (level === "act" && kept) yield* tellBuilder(roomId, ticket, "guidance-pass:open", `Your user's review "${ticket.title ?? ticket.goal}" is open to its readers now${rounds}: ${how}. Tell your user in one line.`);
        return `opened "${ticket.title ?? ticket.goal}" to its readers${rounds}: ${how}.`;
      });

    /** What the pass found: open it, or hand it to the conversation that built it to fix, or stop and ask. */
    const report = (roomId: string, ticketId: string, round: number, passed: boolean, findings: ReadonlyArray<Shortfall>) =>
      Effect.gen(function* () {
        const kept = (yield* store.get).preparing?.[ticketId];
        if (!kept || kept.stage !== "checking" || kept.round !== round) return `failed: review ${ticketId} is not waiting on round ${round} of its guidance pass`;
        if (passed || findings.length === 0) return yield* open(roomId, ticketId, kept.round === 1 ? "it follows every steering note that applies" : "it follows every steering note now");
        const found = yield* reviewOf(roomId, ticketId);
        if (!found) return "failed: that review is gone";
        const listed = findings.map((short) => `- note ${short.note}${short.where ? ` at ${short.where}` : ""}: ${short.what}`).join("\n");
        const now = yield* Clock.currentTimeMillis;
        // the work steering decides whether the conversation that built it fixes it on its own
        const work = levelOf(yield* store.get, "work", "mine", roomId);
        if (round >= ROUNDS || (work !== "act" && work !== "auto") || !found.ticket.conversation) {
          yield* keep(ticketId, { roomId, round, stage: "stuck", findings: listed, at: now });
          const why = round >= ROUNDS ? `stopped after ${ROUNDS} rounds` : !found.ticket.conversation ? "no conversation of theirs is known to have built it" : "their work steering does not let it be fixed on its own";
          yield* tellBuilder(
            roomId,
            found.ticket,
            "guidance-pass:stuck",
            `The guidance pass on your user's review "${found.ticket.title ?? found.ticket.goal}" ${why}; still short of:\n${listed}\nIt stays being prepared, seen by nobody else. Tell your user, in one line, and let them choose: fix it (then guidance-pass action fixed), or send it as it is (guidance-pass action open, on their word).`,
          );
          return `stuck: ${why}. Your user decides: fix it, or open it as it is.`;
        }
        yield* keep(ticketId, { roomId, round, stage: "fixing", findings: listed, at: now });
        yield* tellBuilder(
          roomId,
          found.ticket,
          "guidance-pass:fix",
          `Your user's guidance pass (round ${round} of ${ROUNDS}) found their review "${found.ticket.title ?? found.ticket.goal}" short of the room's steering notes:\n${listed}\nFix it now, on its branch, without asking them — their steering lets you. Then amend the review's why (ask-review with ticketId "${ticketId}": a decision per fix, guidedBy ["note:<id>"]) and call guidance-pass action fixed with ticketId "${ticketId}". The review stays hidden from everyone else until it passes.`,
        );
        return `handed to the conversation that built it to fix (round ${round} of ${ROUNDS}).`;
      });

    /** The builder fixed what fell short: the pass runs again. */
    const fixed = (roomId: string, ticketId: string) =>
      Effect.gen(function* () {
        const kept = (yield* store.get).preparing?.[ticketId];
        if (!kept || (kept.stage !== "fixing" && kept.stage !== "stuck")) return `failed: review ${ticketId} is not waiting on a fix`;
        if (kept.round >= ROUNDS) return yield* open(roomId, ticketId, `fixed after ${ROUNDS} rounds; not checked again`);
        return yield* check(roomId, ticketId, kept.round + 1);
      });

    // a pass that ended without its verdict: stopped, and the person asked
    const ended = new Set<string>();
    yield* SubscriptionRef.changes(jobs.views).pipe(
      Stream.map((views) => views.filter((view) => view.kind === "guidance" && (view.state === "done" || view.state === "failed") && !ended.has(view.id))),
      Stream.tap((finished) =>
        Effect.forEach(
          finished,
          (view) =>
            Effect.gen(function* () {
              ended.add(view.id);
              const kept = (yield* store.get).preparing?.[view.ticketId];
              if (!kept || kept.stage !== "checking") return;
              const found = yield* reviewOf(kept.roomId, view.ticketId);
              yield* keep(view.ticketId, { ...kept, stage: "stuck", findings: `the pass ended without saying${view.note ? `: ${view.note}` : ""}`, at: yield* Clock.currentTimeMillis });
              if (found)
                yield* tellBuilder(
                  kept.roomId,
                  found.ticket,
                  "guidance-pass:stuck",
                  `The guidance pass on your user's review "${found.ticket.title ?? found.ticket.goal}" ended without a verdict. It stays being prepared. Tell your user in one line: run it again (guidance-pass action run) or open it as it is (guidance-pass action open).`,
                );
            }),
          { discard: true },
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    /** Start preparing a review just filed (its ticket already marked preparing), or one the person asks to run. */
    const start = (roomId: string, ticketId: string) =>
      Effect.gen(function* () {
        const found = yield* reviewOf(roomId, ticketId);
        if (!found) return "failed: no review of your user's by that id";
        if (!found.ticket.preparing) yield* mark(roomId, found.ticket, true);
        return yield* check(roomId, ticketId, 1);
      });

    /** How a review being prepared stands, for the person: null when it is not. */
    const status = (ticketId: string) => store.get.pipe(Effect.map((state) => state.preparing?.[ticketId] ?? null));

    return { start, report, fixed, open, status } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
