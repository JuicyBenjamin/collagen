import { Clock, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { NodeServices } from "@effect/platform-node";
import { Room, RoomConfig, actionableSteps, roomProjects, type RoomMessage } from "@collagen/p2p";
import { AdaptersLive } from "./Adapters";
import { AiStatus } from "./AiStatus";
import { CliArgs } from "./CliArgs";
import { AgentRunner } from "./AgentRunner";
import { loadDevBootstrap } from "./DevBootstrap";
import { IdentityService } from "./Identity";
import { readProfileFile, upsertActiveRoom } from "../profileFile";
import { Inbox } from "./Inbox";
import { LogBuffer, LoggerLive } from "./Logging";
import { McpInfo } from "./McpInfo";
import { McpLive } from "./Mcp";
import { registerAll } from "./Registrar";
import { Scripting } from "./Scripting";
import { StateStore } from "./StateStore";

/** Room wiring: identity + live profile (re-read from state on every broadcast). */
const RoomConfigLive = Layer.effect(
  RoomConfig,
  Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const { identity, room, nameRef } = yield* IdentityService;
    const store = yield* StateStore;
    const aiStatus = yield* AiStatus;
    const bootstrap = yield* loadDevBootstrap;
    const stored = readProfileFile(profile).rooms?.find((r) => r.id === room.id);
    return {
      identity,
      roomName: room.id,
      roomLabel: { name: room.name, ts: stored?.nameTs ?? 0 },
      getProfile: Effect.gen(function* () {
        const s = yield* store.get;
        const status = yield* SubscriptionRef.get(aiStatus.current);
        return {
          name: yield* SubscriptionRef.get(nameRef),
          ai: s.preferredAi,
          aiStatus: status,
          projects: roomProjects(s, room.id).map((p) => ({ name: p.name, path: p.path })),
        };
      }),
      bootstrap: Option.getOrUndefined(bootstrap),
    };
  }),
);

/** Background rules that make the app *behave*: incoming message → inbox +
 *  agent run; state change → profile re-broadcast; MCP up → register in AIs. */
const Daemons = Layer.effectDiscard(
  Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;
    const runner = yield* AgentRunner;
    const store = yield* StateStore;

    yield* room.messages.pipe(
      Stream.tap((m) => Effect.log(`← ${m.fromName} [${m.project}/${m.intent}]`)),
      Stream.tap((m) => inbox.push(m)),
      // fork: a running agent must not block message intake
      Stream.tap((m) => Effect.forkChild(runner.runThread(m.threadId))),
      Stream.runDrain,
      Effect.forkScoped,
    );

    const aiStatus = yield* AiStatus;
    // Startup probe + re-probe whenever the preferred AI changes; profile
    // re-broadcasts on state AND status changes, so peers see (un)auth live.
    yield* SubscriptionRef.changes(store.state).pipe(
      Stream.map((s) => s.preferredAi),
      Stream.changes,
      Stream.tap((ai) => aiStatus.refresh(ai)),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(aiStatus.current).pipe(
      Stream.drop(1),
      Stream.tap(() => room.updateProfile),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(store.state).pipe(
      Stream.drop(1), // skip the initial value — peers got it on connect
      Stream.tap(() => room.updateProfile),
      Stream.runDrain,
      Effect.forkScoped,
    );

    // Ticket steps becoming actionable for THIS peer wake the local agent:
    // the ticket record is the suspended state, the nudge resumes it. Only
    // pending steps are nudged — the nudge itself marks them suspended (and
    // gossips that), so repeated merges don't re-trigger a running agent.
    const { identity } = yield* IdentityService;
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
            for (const s of mine) {
              const settled = ticket.steps
                .filter((x) => x.status === "settled" && s.needs.includes(x.id))
                .map((x) => `- ${x.id} (${x.intent}): ${x.result ?? ""}`)
                .join("\n");
              const msg: RoomMessage = {
                id: crypto.randomUUID(),
                threadId: ticket.threadId,
                from: ticket.createdBy,
                fromName: "ticket",
                project: ticket.project,
                intent: `ticket-step:${s.intent}`,
                findings: `Ticket "${ticket.goal}" (${ticket.id}) — you own step ${s.id}: ${s.description}${
                  settled ? `\nSettled inputs:\n${settled}` : ""
                }\nWhen done, call settle-step with ticketId "${ticket.id}", stepId "${s.id}", and your findings.`,
                ts: now,
              };
              yield* Effect.log(`⧉ ticket ${ticket.id.slice(0, 8)} step ${s.id} actionable`);
              yield* inbox.push(msg);
              yield* Effect.forkChild(runner.runThread(ticket.threadId));
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
                threadId: id,
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

    // A shared room name (local rename OR gossiped from a peer) is persisted
    // so it survives restarts.
    const { profile } = yield* CliArgs;
    const { room: roomInfo, nameRef } = yield* IdentityService;
    // display-name change → peers see it live
    yield* SubscriptionRef.changes(nameRef).pipe(
      Stream.drop(1),
      Stream.tap(() => room.updateProfile),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(room.meta).pipe(
      Stream.drop(1),
      Stream.tap((m) =>
        Effect.sync(() => upsertActiveRoom(profile, { id: roomInfo.id, name: m.name, nameTs: m.ts })),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    yield* registerAll.pipe(Effect.forkScoped);
  }),
);

/** The whole app apart from the UI. Requires CliArgs. */
export const AppLayer = Layer.mergeAll(Daemons, McpLive).pipe(
  Layer.provideMerge(AgentRunner.layer),
  Layer.provideMerge(Scripting.layer),
  Layer.provideMerge(Room.layer),
  Layer.provideMerge(RoomConfigLive),
  Layer.provideMerge(AiStatus.layer),
  Layer.provideMerge(AdaptersLive),
  Layer.provideMerge(Inbox.layer),
  Layer.provideMerge(McpInfo.layer),
  Layer.provideMerge(StateStore.layer),
  Layer.provideMerge(IdentityService.layer),
  Layer.provideMerge(LoggerLive),
  Layer.provideMerge(LogBuffer.layer),
  Layer.provideMerge(NodeServices.layer),
);
