import { Clock, Context, Effect, Exit, Layer, Scope, Stream, SubscriptionRef } from "effect";
import { Room, RoomConfig, Swarm, actionableSteps, roomProjects, shortRoomId, stepThreadId, type RoomMessage } from "@collagen/p2p";
import { readProfileFile, upsertActiveRoom, upsertRoom, writeProfileFile, type RoomEntry } from "../config/profileFile";
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
          Stream.tap((m) => Effect.log(`← ${m.fromName} [${m.project}/${m.intent}]`)),
          Stream.tap((m) => inbox.push(h.id, m)),
          // fork: a running agent must not block message intake
          Stream.tap((m) => Effect.forkChild(runner.runThread(m.threadId))),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // Ticket steps becoming actionable for THIS peer wake the local agent:
        // the ticket record is the suspended state, the nudge resumes it. Only
        // pending steps are nudged — the nudge itself marks them suspended (and
        // broadcasts that), so repeated merges don't re-trigger a running agent.
        yield* SubscriptionRef.changes(room.tickets).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function* (all) {
              const now = yield* Clock.currentTimeMillis;
              for (const ticket of all.values()) {
                const mine = actionableSteps(ticket, identity.pubkey).filter((s) => s.status === "pending");
                if (mine.length === 0) continue;
                yield* room.shareTicket({
                  ...ticket,
                  updatedAt: now,
                  steps: ticket.steps.map((s) =>
                    mine.some((m) => m.id === s.id) ? { ...s, status: "suspended" as const, updatedAt: now } : s,
                  ),
                });
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
                    project: ticket.project,
                    intent: `ticket-step:${s.intent}`,
                    findings: `Ticket "${ticket.goal}" (${ticket.id}) — you own step ${s.id}: ${s.description}${
                      settled ? `\nSettled inputs:\n${settled}` : ""
                    }\nWhen done, call settle-step with ticketId "${ticket.id}", stepId "${s.id}", and your findings.`,
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
                    .sendTo(from, { project: action.project, intent: action.intent, findings: action.findings })
                    .pipe(Effect.catchTag("PeerNotConnected", () => Effect.logWarning("drive reply: peer gone")));
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
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );

        // The shared room name (local rename OR received from a peer) is
        // persisted so it survives restarts. upsertRoom, never
        // upsertActiveRoom: a rename must not change which room is focused.
        yield* SubscriptionRef.changes(room.meta).pipe(
          Stream.drop(1),
          Stream.tap((m) => Effect.sync(() => upsertRoom(profile, { id: h.id, name: m.name, nameTs: m.ts }))),
          Stream.runDrain,
          Effect.forkScoped,
        );
      });

    /** Bring a room to life (idempotent). */
    const open = Effect.fn("Rooms.open")(function* (entry: RoomEntry) {
      const existing = (yield* SubscriptionRef.get(handles)).find((h) => h.id === entry.id);
      if (existing) return existing;
      const scope = yield* Scope.make();
      const config: Context.Service.Shape<typeof RoomConfig> = {
        roomName: entry.id,
        roomLabel: { name: entry.name, ts: entry.nameTs ?? 0 },
        getProfile: profileFor(entry.id),
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

    return { handles, focused, current, setFocus, join, summaries, summaryChanges, watch } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
