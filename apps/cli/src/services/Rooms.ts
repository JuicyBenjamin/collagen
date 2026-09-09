import { Clock, Context, Effect, Exit, Layer, Scope, Stream, SubscriptionRef } from "effect";
import { PROTOCOL_VERSION, Room, RoomConfig, Swarm, actionableSteps, roomProjects, shortRoomId, stepThreadId, type RoomMessage, type Ticket } from "@collagen/p2p";
import { readProfileFile, upsertActiveRoom, upsertRoom, writeProfileFile, type RoomEntry } from "../config/profileFile";
import { isParticipant, myThreadFor, stepChanges, stepUpdateText, weighInText } from "../lib/ticketUpdates";
import { AgentRunner } from "./AgentRunner";
import { AiStatus } from "./AiStatus";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { Inbox } from "./Inbox";
import { StateStore } from "./StateStore";

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
  /** Messages for you still waiting in that room's inbox. */
  readonly unread: number;
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
    const swarm = yield* Swarm;

    const focused = yield* SubscriptionRef.make(initial.id);
    const handles = yield* SubscriptionRef.make<ReadonlyArray<RoomHandle>>([]);
    const scopes = new Map<string, Scope.Closeable>();

    const profileFor = (roomId: string) =>
      Effect.gen(function* () {
        const s = yield* store.get;
        return {
          name: yield* SubscriptionRef.get(nameRef),
          ai: s.preferredAi,
          aiStatus: yield* SubscriptionRef.get(aiStatus.current),
          protocol: PROTOCOL_VERSION,
          projects: roomProjects(s, roomId).map((p) => ({ name: p.name, path: p.path })),
          away: (yield* SubscriptionRef.get(focused)) !== roomId,
        };
      });

    const broadcastAll = Effect.gen(function* () {
      for (const h of yield* SubscriptionRef.get(handles)) yield* h.room.updateProfile;
    });

    /** Background rules for one room: incoming message → inbox + agent run;
     *  actionable ticket step → nudge; drive requests (mock peers only);
     *  shared room name → persisted. Runs inside the room's scope. */
    const daemons = (h: RoomHandle) =>
      Effect.gen(function* () {
        const { room } = h;
        yield* room.messages.pipe(
          Stream.tap(({ msg }) => Effect.log(`← ${msg.fromName} [${msg.project}/${msg.intent}]`)),
          Stream.tap(({ msg, seq }) => inbox.push(h.id, msg, seq)),
          // fork: a running agent must not block message intake
          Stream.tap(({ msg }) => Effect.forkChild(runner.runThread(msg.threadId))),
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
                const mine = actionableSteps(ticket, identity.pubkey).filter(
                  (s) => s.status === "pending" || (redeliver && s.status === "suspended"),
                );
                if (mine.length === 0) continue;
                yield* room.shareTicket({
                  ...ticket,
                  updatedAt: now,
                  steps: ticket.steps.map((s) =>
                    mine.some((m) => m.id === s.id) ? { ...s, status: "suspended" as const, updatedAt: now } : s,
                  ),
                }).pipe(Effect.catchTag("NotWritable", () => Effect.logWarning("cannot mark step delivered: not admitted to the room log")));
                // the step is the creator's ask, so it arrives from them by name
                const creatorName =
                  ticket.createdBy === identity.pubkey
                    ? yield* SubscriptionRef.get(nameRef)
                    : ((yield* SubscriptionRef.get(room.roster)).find((p) => p.key === ticket.createdBy)?.name ??
                      ticket.createdBy.slice(0, 8));
                for (const s of mine) {
                  const settled = ticket.steps
                    .filter((x) => x.status === "settled" && s.needs.includes(x.id))
                    .map((x) => `- ${x.id} (${x.intent}): ${x.result ?? ""}`)
                    .join("\n");
                  const threadId = stepThreadId(ticket, s);
                  const msg: RoomMessage = {
                    id: crypto.randomUUID(),
                    threadId,
                    from: ticket.createdBy,
                    fromName: creatorName,
                    to: identity.pubkey,
                    project: ticket.project,
                    intent: `ticket-step:${s.intent}`,
                    findings: `${creatorName} asks your user to "${s.intent}" for the ticket "${ticket.goal}" (${ticket.id}, step ${s.id}).\nThe step, in full: ${s.description}${
                      settled ? `\nSettled inputs from earlier steps:\n${settled}` : ""
                    }\nYour user decides whether and how this gets done — do not start on it by yourself. When they say it is done (or declined), call settle-step with ticketId "${ticket.id}", stepId "${s.id}", and the result they want to send; it waits for their approval in the collagen TUI.`,
                    ts: now,
                  };
                  yield* Effect.log(`⧉ ticket ${ticket.id.slice(0, 8)} step ${s.id} actionable`);
                  yield* inbox.push(h.id, msg);
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
            return peers.find((p) => p.key === key)?.name ?? members.find((m) => m.key === key)?.name ?? key.slice(0, 8);
          });
        const notify = (threadId: string, from: string, fromName: string, ticket: Ticket, what: string, findings: string) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const msg: RoomMessage = {
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
            };
            yield* Effect.log(`⧉ ticket ${ticket.id.slice(0, 8)}: ${fromName} ${what} — telling your agent`);
            yield* inbox.push(h.id, msg);
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
              for (const c of stepChanges(prev, all)) {
                if (c.step.owner === identity.pubkey) continue; // our own doing
                if (!isParticipant(c.ticket, trace, identity.pubkey)) continue;
                if (actionableSteps(c.ticket, identity.pubkey).length > 0) continue; // the step delivery covers it
                const actorName = yield* nameOf(c.step.owner);
                yield* notify(myThreadFor(c.ticket, trace, identity.pubkey, c.step.owner), c.step.owner, actorName, c.ticket, c.to, stepUpdateText(c, actorName));
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
              for (const m of trace.slice(start)) {
                if (!m.ticketId || m.from === identity.pubkey || m.to === identity.pubkey) continue;
                const ticket = tickets.get(m.ticketId);
                if (!ticket || !isParticipant(ticket, trace, identity.pubkey)) continue;
                yield* notify(myThreadFor(ticket, trace, identity.pubkey, m.from), m.from, m.fromName, ticket, "weighed in", weighInText(ticket, m, yield* nameOf(m.to)));
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
              const s = yield* store.get;
              if (!(s.preferredAi ?? "").startsWith("mock")) {
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
                    updatedAt: now,
                    steps: action.steps.map((st, i) => ({
                      id: `s${i + 1}`,
                      owner: st.mine ? identity.pubkey : from,
                      intent: st.intent,
                      description: st.description,
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
                  yield* room.shareTicket({
                    ...ticket,
                    updatedAt: now,
                    steps: ticket.steps.map((st) =>
                      st.id === action.stepId
                        ? { ...st, status: "settled" as const, result: action.result, updatedAt: now }
                        : st,
                    ),
                  });
                  return;
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
          Stream.tap((m) => Effect.sync(() => relabelRoom(profile, h.id, m))),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // The log's key, once learned, is remembered: with it the room
        // reopens on its own, without waiting for a member to be online.
        yield* SubscriptionRef.changes(room.logKey).pipe(
          Stream.filter((k): k is string => k !== null),
          Stream.tap((logKey) =>
            Effect.sync(() => {
              const entry = readProfileFile(profile).rooms?.find((r) => r.id === h.id);
              if (entry && entry.logKey !== logKey) upsertRoom(profile, { ...entry, logKey });
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
      });

    /** Keep an entry's identity fields (log key, creator) when only the name moved. */
    const relabelRoom = (prof: string, id: string, m: { name: string; ts: number }) => {
      const entry = readProfileFile(prof).rooms?.find((r) => r.id === id);
      upsertRoom(prof, { ...(entry ?? { id }), id, name: m.name, nameTs: m.ts });
    };

    /** Bring a room to life (idempotent). */
    const open = Effect.fn("Rooms.open")(function* (entry: RoomEntry) {
      const existing = (yield* SubscriptionRef.get(handles)).find((h) => h.id === entry.id);
      if (existing) return existing;
      const scope = yield* Scope.make();
      const config: Context.Service.Shape<typeof RoomConfig> = {
        roomName: entry.id,
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
      yield* SubscriptionRef.update(handles, (hs) => [...hs, handle]);
      yield* Effect.log(`room open: ${entry.name} [${shortRoomId(entry.id)}]`);
      return handle;
    });

    // every room this profile knows comes up at start
    yield* Effect.forEach(knownRooms, open, { discard: true });
    yield* Effect.addFinalizer(() =>
      Effect.forEach([...scopes.values()], (s) => Scope.close(s, Exit.void), { discard: true }),
    );

    /** The room being looked at / worked in. */
    const current = Effect.gen(function* () {
      const id = yield* SubscriptionRef.get(focused);
      const h = (yield* SubscriptionRef.get(handles)).find((x) => x.id === id);
      if (!h) return yield* Effect.die(`focused room ${id} is not open`);
      return h;
    });

    /** Look at (work in) another room: instant; every room re-broadcasts our
     *  presence so peers see where we are. Persisted as the active room. */
    const setFocus = Effect.fn("Rooms.setFocus")(function* (id: string) {
      const h = (yield* SubscriptionRef.get(handles)).find((x) => x.id === id);
      if (!h) return false;
      yield* SubscriptionRef.set(focused, id);
      const entry = readProfileFile(profile).rooms?.find((r) => r.id === id);
      yield* Effect.sync(() => (entry ? upsertActiveRoom(profile, entry) : writeProfileFile(profile, { activeRoomId: id })));
      yield* broadcastAll;
      return true;
    });

    /** Join (or create) a room live. */
    const join = Effect.fn("Rooms.join")(function* (entry: RoomEntry, focus: boolean) {
      yield* Effect.sync(() => upsertRoom(profile, entry));
      const h = yield* open(entry);
      if (focus) yield* setFocus(entry.id);
      return h;
    });

    /** Leave a room: forget it locally and stop taking part. The log and its
     *  history stay with the other members (and on disk here — a rejoin by
     *  invite would pick the same log up). Refused for the last room: the app
     *  needs one to look at. */
    const leave = Effect.fn("Rooms.leave")(function* (id: string) {
      const hs = yield* SubscriptionRef.get(handles);
      const h = hs.find((x) => x.id === id);
      if (!h) return "not in that room";
      if (hs.length === 1) return "cannot leave your only room — join or create another first";
      const remaining = hs.filter((x) => x.id !== id);
      if ((yield* SubscriptionRef.get(focused)) === id) yield* setFocus(remaining[0]!.id);
      yield* SubscriptionRef.set(handles, remaining);
      const scope = scopes.get(id);
      scopes.delete(id);
      if (scope) yield* Scope.close(scope, Exit.void);
      yield* Effect.sync(() => {
        const f = readProfileFile(profile);
        writeProfileFile(profile, { rooms: (f.rooms ?? []).filter((r) => r.id !== id) });
      });
      yield* Effect.log(`left room [${shortRoomId(id)}]`);
      return "left";
    });

    const summaries: Effect.Effect<ReadonlyArray<RoomSummary>> = Effect.gen(function* () {
      const f = yield* SubscriptionRef.get(focused);
      const counts = yield* inbox.unread;
      const out: RoomSummary[] = [];
      for (const h of yield* SubscriptionRef.get(handles)) {
        const peers = yield* SubscriptionRef.get(h.room.roster);
        const meta = yield* SubscriptionRef.get(h.room.meta);
        out.push({
          id: h.id,
          shortId: shortRoomId(h.id),
          name: meta.name,
          online: peers.filter((p) => !p.away).length + (h.id === f ? 1 : 0),
          unread: counts.get(h.id) ?? 0,
          focused: h.id === f,
        });
      }
      return out;
    });

    /** `summaries`, live: re-evaluated whenever a room opens, focus moves, a
     *  message lands or is picked up, or any room's roster/name changes. */
    const pulse = <A>(s: Stream.Stream<A>): Stream.Stream<void> => Stream.map(s, () => undefined);
    const summaryChanges: Stream.Stream<ReadonlyArray<RoomSummary>> = SubscriptionRef.changes(handles).pipe(
      Stream.switchMap((hs) =>
        Stream.mergeAll(
          [
            pulse(SubscriptionRef.changes(focused)),
            pulse(SubscriptionRef.changes(inbox.buffer)),
            ...hs.flatMap((h) => [pulse(SubscriptionRef.changes(h.room.roster)), pulse(SubscriptionRef.changes(h.room.meta))]),
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
    const tick = <A>(s: Stream.Stream<A>) => s.pipe(Stream.drop(1), Stream.map(() => undefined));
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
