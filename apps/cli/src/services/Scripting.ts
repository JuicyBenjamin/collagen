import { Context, Effect, Layer, SubscriptionRef } from "effect";
import { scriptEngine, tool, type AgentExecuteResult } from "callscript";
import { Room } from "@collagen/p2p";
import { Inbox } from "./Inbox";

/** CallScript engine with collagen's tools mounted. Spawned agents author one
 *  small JS program (compiled to an inert JSON plan — never executed as code)
 *  instead of one MCP round-trip per step: query the room, fan out messages
 *  to peers bounded by `max`, collect the results. */
export class Scripting extends Context.Service<Scripting>()("cli/Scripting", {
  make: Effect.gen(function* () {
    const room = yield* Room;
    const inbox = yield* Inbox;
    // Callscript tools are plain async functions; capture the service map so
    // effects run with the app's services (logger etc).
    const services = yield* Effect.context<never>();
    const runP = Effect.runPromiseWith(services);

    const listRoom = tool({
      name: "collagen.listRoom",
      description:
        "List the peers currently in your collagen room and the projects each shares.",
      outputSchema: {
        type: "object",
        properties: {
          peers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                ai: { type: ["string", "null"] },
                projects: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      idempotent: true,
      execute: () =>
        runP(
          SubscriptionRef.get(room.roster).pipe(
            Effect.map((peers) => ({
              peers: peers.map((p) => ({ name: p.name, ai: p.ai, projects: p.projects.map((x) => x.name) })),
            })),
          ),
        ),
    });

    const sendToPeer = tool({
      name: "collagen.sendToPeer",
      description:
        "Send a finding or request to a peer about a project. The peer's AI is triggered with your message. 'intent' is a short verb like 'flag-issue' or 'ask-review'; 'findings' carries the full context plus what you want back.",
      inputSchema: {
        type: "object",
        properties: {
          peer: { type: "string" },
          project: { type: "string" },
          intent: { type: "string" },
          findings: { type: "string" },
        },
        required: ["peer", "project", "intent", "findings"],
      },
      outputSchema: { type: "object", properties: { delivered: { type: "boolean" }, detail: { type: "string" } } },
      errors: ["peer_not_found", "peer_not_connected"],
      execute: (args: { peer: string; project: string; intent: string; findings: string }) =>
        runP(
          Effect.gen(function* () {
            const peers = yield* SubscriptionRef.get(room.roster);
            const target = peers.find((p) => p.name === args.peer);
            if (!target) return { delivered: false, detail: `no peer named ${args.peer}` };
            return yield* room
              .sendTo(target.key, { project: args.project, intent: args.intent, findings: args.findings })
              .pipe(
                Effect.map(() => ({ delivered: true, detail: `sent to ${args.peer}` })),
                Effect.catchTag("PeerNotConnected", () =>
                  Effect.succeed({ delivered: false, detail: "peer not connected" }),
                ),
              );
          }),
        ),
    });

    const getMessages = tool({
      name: "collagen.getMessages",
      description:
        "Retrieve and clear messages sent to you. Pass a threadId to take just that conversation's messages.",
      inputSchema: {
        type: "object",
        properties: { threadId: { type: "string" } },
      },
      outputSchema: {
        type: "object",
        properties: { messages: { type: "array", items: { type: "object" } } },
      },
      execute: (args: { threadId?: string } | void) =>
        runP(inbox.take(args?.threadId ?? undefined).pipe(Effect.map((messages) => ({ messages })))),
    });

    const engine = scriptEngine({ tools: [listRoom, sendToPeer, getMessages] });
    const agent = engine.agentTools();

    const execute = (script: string, input?: unknown): Promise<AgentExecuteResult> =>
      agent.execute.execute(input === undefined ? { script } : { script, input }) as Promise<AgentExecuteResult>;
    const search = (query: string, limit?: number): Promise<string> =>
      agent.search.execute({ query, limit: limit ?? 5 });
    const describe = (): string => engine.describe();

    return { engine, execute, search, describe } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
