import { joinedRoom } from "../lib/merging";
import { Clock, Context, Effect, Exit, Layer, Scope, Stream, SubscriptionRef } from "effect";
import { PROTOCOL_VERSION, Room, RoomConfig, Swarm, actionableSteps, gated, postReview, roomProjects, settleStep, shortRoomId, stepThreadId, visibleTo, type Conversation, type RoomMessage, type Ticket } from "@collagen/p2p";
import { readProfileFile, upsertActiveRoom, upsertRoom, writeProfileFile, type RoomEntry } from "../config/profileFile";
import { answeredInvestigations, investigationAnsweredText, isParticipant, myThreadFor, reviewChanges, reviewUpdateText, stepChanges, stepUpdateText, stepUpdateWhat, weighInText } from "../lib/ticketUpdates";
import { NET } from "../app/net";
import { AgentRunner } from "./AgentRunner";
import { Jobs } from "./Jobs";
import { levelOf } from "../lib/steering";
import { investigationOf } from "../lib/jobs";
import { sameName } from "../lib/names";
import { homedir } from "node:os";
import { AiStatus } from "./AiStatus";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { StateStore } from "./StateStore";
import { workLine } from "../lib/steering";
import { describeIdentity, ownIdentities } from "./Authorship";
import { hostOf } from "./RepoHost";
import { actedBy } from "../lib/agents";

export type RoomService = Context.Service.Shape<typeof Room>;

/** A live room: the swarm + its daemons, running in its own scope. */
export interface RoomHandle {
  readonly id: string;
  readonly room: RoomService;
}

/** What a person (or their agent) needs to know about a room they're NOT
 *  looking at — one short line per room, never its contents. */
export interface RoomSummary {
  readonly id: string;
  readonly shortId: string;
  readonly name: string;
  /** People present (not away) — you included in the room you're looking at. */
  readonly online: number;
  /** Messages for you still waiting in that room's inbox — what an agent
   *  has yet to pull, ticket-update context included. */
  readonly unread: number;
  /** The part of `unread` that asks the person to act: a peer's message,
   *  a step that became theirs. The rail's dot. */
  readonly needsYou: number;
  readonly focused: boolean;
}

/** All the rooms this profile is in, live at once — like conversations, you
 *  are in many and look at one. They share the identity's one swarm (a room
 *  is a topic on it). The focused room is where you work: you're
 *  `away` everywhere else (connected, receiving, not counted as online, and
 *  nothing auto-runs for you there). Switching focus is instant. */
export class Rooms extends Context.Service<Rooms>()("cli/Rooms", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const { identity, room: initial, knownRooms, nameRef } = yield* IdentityService;
    const store = yield* StateStore;
    const aiStatus = yield* AiStatus;
    const inbox = yield* Inbox;
    const runner = yield* AgentRunner;
    const jobs = yield* Jobs;
    const swarm = yield* Swarm;

    const focused = yield* SubscriptionRef.make(initial.id);
    const handles = yield* SubscriptionRef.make<ReadonlyArray<RoomHandle>>([]);
    const scopes = new Map<string, Scope.Closeable>();

    const profileFor = (roomId: string) =>
      Effect.gen(function* () {
        const state = yield* store.get;
        return {
          name: yield* SubscriptionRef.get(nameRef),
          ai: state.preferredAi,
          aiStatus: yield* SubscriptionRef.get(aiStatus.current),
          protocol: PROTOCOL_VERSION,
          projects: roomProjects(state, roomId).map((project) => ({ name: project.name, path: project.path })),
          away: (yield* SubscriptionRef.get(focused)) !== roomId,
        };
      });

    const broadcastAll = Effect.gen(function* () {
      for (const handle of yield* SubscriptionRef.get(handles)) yield* handle.room.updateProfile;
    });

    /** Background rules for one room: incoming message → inbox + agent run;
     *  actionable ticket step → nudge; drive requests (mock peers only);
     *  shared room name → persisted. Runs inside the room's scope. */
    const daemons = (handle: RoomHandle) =>
      Effect.gen(function* () {
        const { room } = handle;
        yield* room.messages.pipe(
          Stream.tap(({ message }) => Effect.log(`← ${message.fromName} [${message.project}/${message.intent}]`)),
          Stream.tap(({ message, seq }) => inbox.push(handle.id, message, seq)),
          // fork: a running agent must not block message intake
          Stream.tap(({ message }) => Effect.forkChild(runner.runThread(message.threadId))),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // Ticket steps becoming actionable for THIS peer wake the local agent:
        // the ticket record is the suspended state, the nudge resumes it. Only
        // pending steps are nudged — the nudge itself marks them suspended (and
        // broadcasts that), so repeated merges don't re-trigger a running agent.
        // Exception: the first pass over the tickets the log remembers also
        // delivers steps left suspended by a previous run — their delivery
        // message lived in the inbox, which does not survive a restart.
        let firstPass = true;
        yield* SubscriptionRef.changes(room.tickets).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function* (all) {
              const now = yield* Clock.currentTimeMillis;
              const redeliver = firstPass && all.size > 0;
              if (all.size > 0) firstPass = false;
              for (const ticket of all.values()) {
                // a ticket waiting on another (after) is delivered to nobody it
                // waits for — not its readers, who are not shown it, and not its
                // author, whose work waits too. When the ticket it waits on is
                // answered, or this reader approved it, the steps go then.
                if (gated(ticket, all, identity.pubkey)) continue;
                const mine = actionableSteps(ticket, identity.pubkey).filter(
                  (step) => step.status === "pending" || (redeliver && step.status === "suspended"),
                );
                if (mine.length === 0) continue;
                yield* room.shareTicket({
                  ...ticket,
                  updatedAt: now,
                  steps: ticket.steps.map((step) =>
                    mine.some((owned) => owned.id === step.id) ? { ...step, status: "suspended" as const, updatedAt: now } : step,
                  ),
                }).pipe(Effect.catchTag("NotWritable", () => Effect.logWarning("cannot mark step delivered: not admitted to the room log")));
                // the step is the creator's ask, so it arrives from them by name
                const creatorName =
                  ticket.createdBy === identity.pubkey
                    ? yield* SubscriptionRef.get(nameRef)
                    : ((yield* SubscriptionRef.get(room.roster)).find((peer) => peer.key === ticket.createdBy)?.name ??
                      ticket.createdBy.slice(0, 8));
                // the person's steering, said on the step itself: the turn
                // the agent reads it is the turn it is about to act
                const steer = workLine(yield* store.get, ticket.createdBy === identity.pubkey ? "mine" : "others");
                // an investigation asked of the person by someone else: their
                // steering for others' investigations says whether their AI
                // starts on it now, is offered, or is left alone
                const investigating =
                  ticket.kind === "investigation" && ticket.createdBy !== identity.pubkey && mine.some((step) => step.status === "pending")
                    ? yield* Effect.gen(function* () {
                        const state = yield* store.get;
                        const level = levelOf(state, "investigate", "others");
                        if (level === "unset") return "\nYour user's steering for others' investigations is not chosen, so their AI was not started. Ask them once, in a line, to choose one (set-steering kind investigate, whose others).";
                        if (level === "never") return "\nTheir steering for others' investigations is never, so their AI was not started; research starts it on their word.";
                        if (level === "ask") return "\nASK YOUR USER, in one line, whether to send their AI to find out (research with this ticketId): their steering for others' investigations is ask first.";
                        const project = (state.rooms[handle.id] ?? []).find((candidate) => sameName(candidate.name, ticket.project));
                        const investigation = investigationOf(ticket, yield* SubscriptionRef.get(room.reviews), all);
                        const said = yield* jobs.research({ roomId: handle.id, ticket, cwd: project?.path ?? homedir(), cause: "others", investigation });
                        return said.startsWith("failed")
                          ? `\nTheir steering says to start their AI on it, but it could not: ${said.replace(/^failed: /, "")}`
                          : `\nTheir steering for others' investigations started their AI on it: ${said}${level === "act" ? " Tell them, in one line." : ""}`;
                      })
                    : "";
                for (const step of mine) {
                  const settled = ticket.steps
                    .filter((other) => other.status === "settled" && step.needs.includes(other.id))
                    .map((other) => `- ${other.id} (${other.intent}): ${other.result ?? ""}`)
                    .join("\n");
                  const threadId = stepThreadId(ticket, step);
                  const message: RoomMessage = {
                    id: crypto.randomUUID(),
                    threadId,
                    from: ticket.createdBy,
                    fromName: creatorName,
                    to: identity.pubkey,
                    project: ticket.project,
                    intent: `ticket-step:${step.intent}`,
                    findings: `${creatorName} asks your user to "${step.intent}" for the ticket "${ticket.goal}" (${ticket.id}, step ${step.id}).\nThe step, in full: ${step.description}${
                      settled ? `\nSettled inputs from earlier steps:\n${settled}` : ""
                    }\n${steer} When they say it is done (or declined), call settle-step with ticketId "${ticket.id}", stepId "${step.id}", and the result they want to send — it goes out as you call it.${investigating}`,
                    ts: now,
                  };
                  yield* Effect.log(`⧉ ticket ${ticket.id.slice(0, 8)} step ${step.id} actionable`);
                  yield* inbox.push(handle.id, message);
                  yield* Effect.forkChild(runner.runThread(threadId));
                }
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // Ticket updates for participants — the creator, the owners, anyone who
        // weighed in: a step settled or failed, or someone weighed in. A local
        // inbox message on the thread that person's agent knows the ticket by,
        // so their adopted session resumes with it. An owner whose own step
        // just became actionable gets the step delivery (above) instead.
        const nameOf = (key: string) =>
          Effect.gen(function* () {
            if (key === identity.pubkey) return yield* SubscriptionRef.get(nameRef);
            const peers = yield* SubscriptionRef.get(room.roster);
            const members = yield* SubscriptionRef.get(room.members);
            return peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8);
          });
        // `agent`: which of their agents did it, so the agent told can tell a
        // person's own word from another agent's
        // `conversation`: on an act of the person's own, the conversation that
        // did it — told to their other conversations, never back to itself
        const notify = (threadId: string, from: string, fromName: string, ticket: Ticket, what: string, findings: string, agent?: string, conversation?: Conversation) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const message: RoomMessage = {
              id: crypto.randomUUID(),
              threadId,
              from,
              fromName,
              to: identity.pubkey,
              project: ticket.project,
              intent: `ticket-update:${what}`,
              findings,
              ts: now,
              ticketId: ticket.id,
              ...(agent ? { agent } : {}),
              ...(conversation ? { conversation } : {}),
            };
            // where it goes next is the runner's line: inbox, or woken in a conversation by its harness
            yield* Effect.log(`⧉ ticket ${ticket.id.slice(0, 8)}: ${fromName} ${what}`);
            yield* inbox.push(handle.id, message);
            yield* Effect.forkChild(runner.runThread(threadId));
          });
        let prevTickets: ReadonlyMap<string, Ticket> | null = null;
        yield* SubscriptionRef.changes(room.tickets).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function* (all) {
              const prev = prevTickets;
              prevTickets = all;
              if (prev === null) return; // what the log already held is history, not news
              const trace = yield* SubscriptionRef.get(room.trace);
              for (const change of stepChanges(prev, all)) {
                // the person's own doing: news only to their other conversations,
                // when one of theirs did it (from the TUI, it is nobody's news)
                const own = change.step.owner === identity.pubkey;
                if (own && !change.step.conversation) continue;
                if (!visibleTo(change.ticket, all, identity.pubkey)) continue; // not shown to us yet
                if (!isParticipant(change.ticket, trace, identity.pubkey)) continue;
                if (actionableSteps(change.ticket, identity.pubkey).length > 0) continue; // the step delivery covers it
                const actorName = yield* nameOf(change.step.owner);
                yield* notify(myThreadFor(change.ticket, trace, identity.pubkey, change.step.owner), change.step.owner, actorName, change.ticket, stepUpdateWhat(change), stepUpdateText(change, actedBy(actorName, change.step.agent)), change.step.agent, own ? change.step.conversation : undefined);
              }
              // an investigation is over: what it found reaches whoever is on
              // the tickets it grew from, so a plan that stopped on a question
              // goes on with the answer
              const answered = answeredInvestigations(prev, all);
              const reviews = answered.length > 0 ? yield* SubscriptionRef.get(room.reviews) : [];
              for (const { investigation, parents } of answered) {
                const brief = reviews.find((review) => review.ticketId === investigation.id)?.investigation;
                const closer = investigation.closed!.by;
                const closerName = yield* nameOf(closer);
                for (const parent of parents) {
                  if (!visibleTo(parent, all, identity.pubkey) || !isParticipant(parent, trace, identity.pubkey)) continue;
                  yield* notify(myThreadFor(parent, trace, identity.pubkey, closer), closer, closerName, parent, "an investigation is answered", investigationAnsweredText(investigation, parent, brief, closerName));
                }
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        // the why behind a review is revised as the work goes on: the readers
        // hear it, or they are reviewing a ticket that no longer exists
        let prevReviews: Map<string, number> | null = null;
        yield* SubscriptionRef.changes(room.reviews).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function* (all) {
              const prev = prevReviews;
              prevReviews = new Map(all.map((review) => [review.ticketId, review.ts]));
              const trace = yield* SubscriptionRef.get(room.trace);
              const tickets = yield* SubscriptionRef.get(room.tickets);
              for (const review of reviewChanges(prev, all)) {
                // the person's own doing: news only to their other conversations
                const own = review.author === identity.pubkey;
                if (own && !review.conversation) continue;
                const ticket = tickets.get(review.ticketId);
                if (!ticket || !isParticipant(ticket, trace, identity.pubkey)) continue;
                if (!visibleTo(ticket, tickets, identity.pubkey)) continue; // not shown to us yet
                const fresh = prev?.has(review.ticketId) !== true;
                yield* notify(myThreadFor(ticket, trace, identity.pubkey, review.author), review.author, review.authorName, ticket, "revised the why", reviewUpdateText(ticket, review, fresh), review.agent, own ? review.conversation : undefined);
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        // a review built from guesses about this person's own code: their agent
        // is told once — whenever it arrived — so it can answer the guesses
        // from what it knows of why its person wrote it, with little asked.
        // Who wrote what does not change in a run: a review that is not theirs is asked about once
        const notMine = new Set<string>();
        yield* SubscriptionRef.changes(room.reviews).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function* (all) {
              const guessed = all.filter((review) => review.assumed && !review.claimed && review.author !== identity.pubkey && (review.assumed.identities?.length ?? 0) > 0);
              if (guessed.length === 0) return;
              const told = new Set((yield* store.get).toldGuessed ?? []);
              const tickets = yield* SubscriptionRef.get(room.tickets);
              for (const review of guessed) {
                const asked = `${review.ticketId}|${review.assumed!.identities!.join(",")}`;
                if (told.has(review.ticketId) || notMine.has(asked)) continue;
                const ticket = tickets.get(review.ticketId);
                if (!ticket) continue;
                const clone = roomProjects(yield* store.get, handle.id).find((project) => project.name.trim().toLowerCase() === ticket.project.trim().toLowerCase());
                const mine = yield* ownIdentities(clone?.path, review.link ? hostOf(review.link) : undefined);
                const shared = mine.find((ownIdentity) => review.assumed!.identities!.includes(ownIdentity));
                if (!shared) {
                  notMine.add(asked);
                  continue;
                }
                yield* store.update((state) => ({ ...state, toldGuessed: [...(state.toldGuessed ?? []), review.ticketId] }));
                const steer = workLine(yield* store.get, "others");
                const trace = yield* SubscriptionRef.get(room.trace);
                yield* notify(
                  myThreadFor(ticket, trace, identity.pubkey, review.author),
                  review.author,
                  review.authorName,
                  ticket,
                  "guessed why your user wrote their code",
                  `${review.authorName}'s AI built a review of your user's code from guesses about why they wrote it: "${ticket.title ?? ticket.goal}" [ticket ${ticket.id}] — the code is theirs (${describeIdentity(shared)}). ${steer} Answer the guesses for them with claim-review: read them (review-context), then answer from what you already know of why your user wrote it — your conversations with them, their commits, the tickets behind it — and add the decisions the guesses missed. Ask your user only what that does not settle. Then tell them in one line that the review is theirs.`,
                );
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        let seenTrace = -1;
        yield* SubscriptionRef.changes(room.trace).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function* (trace) {
              const start = seenTrace < 0 ? trace.length : seenTrace;
              seenTrace = trace.length;
              const tickets = yield* SubscriptionRef.get(room.tickets);
              for (const message of trace.slice(start)) {
                if (!message.ticketId || message.from === identity.pubkey || message.to === identity.pubkey) continue;
                const ticket = tickets.get(message.ticketId);
                if (!ticket || !isParticipant(ticket, trace, identity.pubkey)) continue;
                if (!visibleTo(ticket, tickets, identity.pubkey)) continue; // not shown to us yet
                yield* notify(myThreadFor(ticket, trace, identity.pubkey, message.from), message.from, message.fromName, ticket, "weighed in", weighInText(ticket, message, yield* nameOf(message.to)), message.agent);
              }
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // Drive requests: a peer remote-controls us for e2e testing — but ONLY
        // when we're running a mock AI. A real user's instance ignores them.
        yield* room.drives.pipe(
          Stream.tap(({ from, action }) =>
            Effect.gen(function* () {
              const state = yield* store.get;
              if (!(state.preferredAi ?? "").startsWith("mock")) {
                return yield* Effect.logWarning(`drive request ignored (not a mock peer): ${action.kind}`);
              }
              yield* Effect.log(`driven by ${from.slice(0, 8)}: ${action.kind}`);
              const now = yield* Clock.currentTimeMillis;
              switch (action.kind) {
                case "send-message":
                  return yield* room
                    .sendTo(from, { project: action.project, intent: action.intent, findings: action.findings, ...(action.ticketId ? { ticketId: action.ticketId } : {}) })
                    .pipe(Effect.catchTag("NotWritable", () => Effect.logWarning("drive reply: not admitted to the room log")));
                case "create-ticket": {
                  const id = crypto.randomUUID();
                  yield* room.shareTicket({
                    id,
                    project: action.project,
                    goal: action.goal,
                    createdBy: identity.pubkey,
                    structureAt: now,
                    kind: "task",
                    updatedAt: now,
                    steps: action.steps.map((step, index) => ({
                      id: `s${index + 1}`,
                      owner: step.mine ? identity.pubkey : from,
                      intent: step.intent,
                      description: step.description,
                      needs: [],
                      status: "pending" as const,
                      updatedAt: now,
                    })),
                  });
                  return;
                }
                case "settle-step": {
                  const all = yield* SubscriptionRef.get(room.tickets);
                  const ticket = all.get(action.ticketId);
                  if (!ticket) return yield* Effect.logWarning(`drive settle: no ticket ${action.ticketId}`);
                  // the same rule the real path uses — a second copy of it
                  // here once made the tests prove something production
                  // never did
                  const done = settleStep(ticket, action.stepId, identity.pubkey, action.result, false, now);
                  if (!done) return yield* Effect.logWarning(`drive settle: no step ${action.stepId} on ${action.ticketId}`);
                  if (done.outcome === "not-yours") return yield* Effect.logWarning(`drive settle: step ${action.stepId} is not ours to settle`);
                  yield* Effect.log(`driven settle: step ${action.stepId} settled`);
                  yield* room.shareTicket(done.ticket);
                  return;
                }
                case "post-review": {
                  const all = yield* SubscriptionRef.get(room.tickets);
                  const ticket = all.get(action.ticketId);
                  // a gated ticket is not shown to this peer: the same refusal as no ticket
                  if (!ticket || !visibleTo(ticket, all, identity.pubkey)) return yield* Effect.logWarning(`drive review: no ticket ${action.ticketId}`);
                  const { ticket: updated, stepId } = postReview(ticket, { key: identity.pubkey, name: yield* SubscriptionRef.get(nameRef) }, action.result, action.failed ?? false, now);
                  yield* Effect.log(`driven review: posted on step ${stepId}`);
                  yield* room.shareTicket(updated);
                  return;
                }
                default: {
                  // a DriveAction kind with no case here is a COMPILE error,
                  // not a silently ignored frame
                  const unhandled: never = action;
                  return yield* Effect.logWarning(`drive: unhandled action ${JSON.stringify(unhandled)}`);
                }
              }
            }).pipe(Effect.catchTag("NotWritable", () => Effect.logWarning(`drive ${action.kind}: not admitted to the room log`))),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // The shared room name (local rename OR received from a peer) is
        // persisted so it survives restarts. upsertRoom, never
        // upsertActiveRoom: a rename must not change which room is focused.
        yield* SubscriptionRef.changes(room.meta).pipe(
          Stream.drop(1),
          Stream.tap((meta) => Effect.sync(() => relabelRoom(profile, handle.id, meta))),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // The log's key, once learned, is remembered: with it the room
        // reopens on its own, without waiting for a member to be online.
        yield* SubscriptionRef.changes(room.logKey).pipe(
          Stream.filter((key): key is string => key !== null),
          Stream.tap((logKey) =>
            Effect.sync(() => {
              const entry = readProfileFile(profile).rooms?.find((roomEntry) => roomEntry.id === handle.id);
              if (entry && entry.logKey !== logKey) upsertRoom(profile, { ...entry, logKey });
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
      });

    /** Keep an entry's identity fields (log key, creator) when only the name moved. */
    const relabelRoom = (prof: string, id: string, meta: { name: string; ts: number }) => {
      const entry = readProfileFile(prof).rooms?.find((roomEntry) => roomEntry.id === id);
      upsertRoom(prof, { ...(entry ?? { id }), id, name: meta.name, nameTs: meta.ts });
    };

    /** Bring a room to life (idempotent). */
    const open = Effect.fn("Rooms.open")(function* (entry: RoomEntry) {
      const existing = (yield* SubscriptionRef.get(handles)).find((live) => live.id === entry.id);
      if (existing) return existing;
      const scope = yield* Scope.make();
      const config: Context.Service.Shape<typeof RoomConfig> = {
        roomName: entry.id,
        net: NET,
        roomLabel: { name: entry.name, ts: entry.nameTs ?? 0 },
        getProfile: profileFor(entry.id),
        // only an explicit flag makes us the creator: `nameTs` is also set when a
        // name is RECEIVED, and two self-appointed creators means two logs
        log: { key: entry.logKey ?? null, creator: entry.creator === true },
      };
      const room = yield* Room.make.pipe(
        Effect.provideService(RoomConfig, config),
        Effect.provideService(Swarm, swarm),
        Effect.provideService(Scope.Scope, scope),
      );
      const handle: RoomHandle = { id: entry.id, room };
      yield* daemons(handle).pipe(Effect.provideService(Scope.Scope, scope));
      scopes.set(entry.id, scope);
      // a room entered takes the person's merge default, once: changing the
      // default later leaves the rooms already set as they were
      yield* store.update((state) => joinedRoom(state, entry.id));
      yield* SubscriptionRef.update(handles, (liveHandles) => [...liveHandles, handle]);
      yield* Effect.log(`room open: ${entry.name} [${shortRoomId(entry.id)}]`);
      return handle;
    });

    // every room this profile knows comes up at start
    yield* Effect.forEach(knownRooms, open, { discard: true });
    yield* Effect.addFinalizer(() =>
      Effect.forEach([...scopes.values()], (scope) => Scope.close(scope, Exit.void), { discard: true }),
    );

    /** The room being looked at / worked in. */
    const current = Effect.gen(function* () {
      const id = yield* SubscriptionRef.get(focused);
      const handle = (yield* SubscriptionRef.get(handles)).find((live) => live.id === id);
      if (!handle) return yield* Effect.die(`focused room ${id} is not open`);
      return handle;
    });

    /** Look at (work in) another room: instant; every room re-broadcasts our
     *  presence so peers see where we are. Persisted as the active room. */
    const setFocus = Effect.fn("Rooms.setFocus")(function* (id: string) {
      const handle = (yield* SubscriptionRef.get(handles)).find((live) => live.id === id);
      if (!handle) return false;
      yield* SubscriptionRef.set(focused, id);
      const entry = readProfileFile(profile).rooms?.find((roomEntry) => roomEntry.id === id);
      yield* Effect.sync(() => (entry ? upsertActiveRoom(profile, entry) : writeProfileFile(profile, { activeRoomId: id })));
      yield* broadcastAll;
      return true;
    });

    /** Join (or create) a room live. */
    const join = Effect.fn("Rooms.join")(function* (entry: RoomEntry, focus: boolean) {
      yield* Effect.sync(() => upsertRoom(profile, entry));
      const handle = yield* open(entry);
      if (focus) yield* setFocus(entry.id);
      return handle;
    });

    /** Leave a room: forget it locally and stop taking part. The log and its
     *  history stay with the other members (and on disk here — a rejoin by
     *  invite would pick the same log up). Refused for the last room: the app
     *  needs one to look at. */
    const leave = Effect.fn("Rooms.leave")(function* (id: string) {
      const liveHandles = yield* SubscriptionRef.get(handles);
      const handle = liveHandles.find((live) => live.id === id);
      if (!handle) return "not in that room";
      if (liveHandles.length === 1) return "cannot leave your only room — join or create another first";
      const remaining = liveHandles.filter((live) => live.id !== id);
      if ((yield* SubscriptionRef.get(focused)) === id) yield* setFocus(remaining[0]!.id);
      yield* SubscriptionRef.set(handles, remaining);
      const scope = scopes.get(id);
      scopes.delete(id);
      if (scope) yield* Scope.close(scope, Exit.void);
      yield* Effect.sync(() => {
        const profileFile = readProfileFile(profile);
        writeProfileFile(profile, { rooms: (profileFile.rooms ?? []).filter((roomEntry) => roomEntry.id !== id) });
      });
      yield* Effect.log(`left room [${shortRoomId(id)}]`);
      return "left";
    });

    const summaries: Effect.Effect<ReadonlyArray<RoomSummary>> = Effect.gen(function* () {
      const focusedId = yield* SubscriptionRef.get(focused);
      const counts = yield* inbox.unread;
      const out: RoomSummary[] = [];
      for (const handle of yield* SubscriptionRef.get(handles)) {
        const peers = yield* SubscriptionRef.get(handle.room.roster);
        const meta = yield* SubscriptionRef.get(handle.room.meta);
        out.push({
          id: handle.id,
          shortId: shortRoomId(handle.id),
          name: meta.name,
          online: peers.filter((peer) => !peer.away).length + (handle.id === focusedId ? 1 : 0),
          unread: counts.get(handle.id)?.unread ?? 0,
          needsYou: counts.get(handle.id)?.needsYou ?? 0,
          focused: handle.id === focusedId,
        });
      }
      return out;
    });

    /** `summaries`, live: re-evaluated whenever a room opens, focus moves, a
     *  message lands or is picked up, or any room's roster/name changes. */
    const pulse = <A>(stream: Stream.Stream<A>): Stream.Stream<void> => Stream.map(stream, () => undefined);
    const summaryChanges: Stream.Stream<ReadonlyArray<RoomSummary>> = SubscriptionRef.changes(handles).pipe(
      Stream.switchMap((liveHandles) =>
        Stream.mergeAll(
          [
            pulse(SubscriptionRef.changes(focused)),
            pulse(SubscriptionRef.changes(inbox.buffer)),
            ...liveHandles.flatMap((handle) => [pulse(SubscriptionRef.changes(handle.room.roster)), pulse(SubscriptionRef.changes(handle.room.meta))]),
          ],
          { concurrency: "unbounded" },
        ),
      ),
      Stream.mapEffect(() => summaries),
    );

    /** A stream that follows the focused room: `select` picks a stream off
     *  the room, and it re-subscribes whenever focus moves. */
    const watch = <A>(select: (h: RoomHandle) => Stream.Stream<A>): Stream.Stream<A> =>
      SubscriptionRef.changes(focused).pipe(
        Stream.mapEffect(() => current),
        Stream.switchMap(select),
      );

    // Our presence and profile in every room follow the shared state.
    const tick = <A>(stream: Stream.Stream<A>) => stream.pipe(Stream.drop(1), Stream.map(() => undefined));
    yield* Stream.mergeAll(
      [tick(SubscriptionRef.changes(store.state)), tick(SubscriptionRef.changes(aiStatus.current)), tick(SubscriptionRef.changes(nameRef))],
      { concurrency: "unbounded" },
    ).pipe(
      Stream.tap(() => broadcastAll),
      Stream.runDrain,
      Effect.forkScoped,
    );

    return { handles, focused, current, setFocus, join, leave, summaries, summaryChanges, watch } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
