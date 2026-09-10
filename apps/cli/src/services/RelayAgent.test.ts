import { describe, expect, it } from "vitest";
import { Effect, Layer, Option, SubscriptionRef } from "effect";
import { LanguageModel, Toolkit, type Prompt } from "effect/unstable/ai";
import { encode as toToon } from "@toon-format/toon";
import type { LocalState, Outgoing, RoomMessage } from "@collagen/p2p";
import { scriptedModel, type Turn } from "../test/scriptedModel";
import { nudgePrompt } from "./Adapters";
import { Dispatch, sent } from "./Dispatch";
import { Inbox } from "./Inbox";
import { GetMessages, PendingThreads, SendToPeer } from "./Mcp";
import { Outbox } from "./Outbox";
import { StateStore } from "./StateStore";

// Human in the loop, receiving side. These tests do not check that a model
// obeys — nothing offline can. They check that what we tell the agent is
// right, and that the real tools do the right thing when an agent follows it:
// headline first, details from collagen when asked, nothing sent without the
// person, and what is sent is exactly what the person decided.

const ROOM = "r1";
const bobsMessage: RoomMessage = {
  id: "m1",
  threadId: "t1",
  from: "bobkey",
  fromName: "bob",
  to: "alicekey",
  project: "sandbox",
  intent: "ask-review",
  findings: "average([2,4]) returns NaN on main; I suspect the loop bound (i <= length). Can you confirm before Friday's release?",
  ts: 1,
};
const nudge = nudgePrompt({ cwd: "/", mcpUrl: "http://127.0.0.1:1/mcp", serverName: "collagen-alice", msg: bobsMessage, sessionId: Option.some("s1") });

/** The same tool definitions the MCP server exposes — descriptions included. */
const RelayToolkit = Toolkit.make(PendingThreads, GetMessages, SendToPeer);

const stateWith = (preferredAi: string | null) =>
  Layer.effect(
    StateStore,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<LocalState>({ preferredAi, rooms: {} });
      return { state, get: SubscriptionRef.get(state), update: (f: (s: LocalState) => LocalState) => SubscriptionRef.update(state, f) } as const;
    }),
  );

/** Records what would have been written to the room instead of writing it. */
const recording = () => {
  const wrote: Array<Outgoing> = [];
  return {
    sent: wrote,
    layer: Layer.succeed(Dispatch, {
      perform: (_room: string, out: Outgoing) => Effect.sync(() => (wrote.push(out), sent(`sent ${out.kind}`))),
    } as const),
  };
};

/** The MCP handlers, minus the room lookup: real Inbox, real Outbox. */
const handlers = RelayToolkit.toLayer(
  Effect.gen(function* () {
    const inbox = yield* Inbox;
    const outbox = yield* Outbox;
    return {
      "pending-threads": () => inbox.pending(ROOM).pipe(Effect.map((threads) => toToon({ threads }))),
      "get-messages": ({ threadId }: { threadId: string }) => inbox.take(ROOM, threadId).pipe(Effect.map((messages) => toToon({ messages }))),
      "send-to-peer": (input: { peer: string; project: string; intent: string; findings: string }) =>
        outbox.tell({
          roomId: ROOM,
          to: input.peer,
          title: `${input.project} · ${input.intent}`,
          outgoing: { kind: "message", peer: input.peer, project: input.project, intent: input.intent, findings: input.findings },
        }),
    };
  }),
);

const user = (text: string): Prompt.MessageEncoded => ({ role: "user", content: [{ type: "text", text }] });
const system = (text: string): Prompt.MessageEncoded => ({ role: "system", content: text });

/** Run one conversation: the nudge as system prompt, then the user's turns,
 *  the model answering each from its script. */
const converse = (turns: ReadonlyArray<Turn>, userTurns: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const model = yield* scriptedModel(turns);
    const d = recording();
    const program = Effect.gen(function* () {
      const inbox = yield* Inbox;
      const outbox = yield* Outbox;
      yield* inbox.push(ROOM, bobsMessage);
      const responses = [];
      for (const text of userTurns) {
        const r = yield* LanguageModel.generateText({ prompt: [system(nudge), user(text)], toolkit: RelayToolkit });
        responses.push({
          text: r.text,
          calls: r.toolCalls.map((c) => ({ name: c.name, params: c.params as Record<string, unknown> })),
          results: r.toolResults.map((x) => String(x.result)),
          pending: (yield* inbox.pending(ROOM)).length,
          outbox: yield* outbox.all,
        });
      }
      return { responses, seen: yield* model.seen, sent: d.sent };
    });
    return yield* program.pipe(
      Effect.provide(
        Layer.mergeAll(model.layer, handlers).pipe(
          Layer.provideMerge(Layer.mergeAll(Inbox.layer, Outbox.layer)),
          Layer.provideMerge(d.layer),
          Layer.provideMerge(stateWith("codex")),
        ),
      ),
    );
  });

describe("what we tell the receiving agent", () => {
  it("the nudge is a headline, not the message", () => {
    expect(nudge).toContain("bob asks your user to address \"ask-review\" on project \"sandbox\"");
    expect(nudge).not.toContain(bobsMessage.findings);
  });

  it("the nudge says: tell the person, wait, read only when asked, from collagen, never invent", () => {
    expect(nudge).toContain("Tell your user exactly that, in one line, and wait");
    expect(nudge).toContain("Do not read the details yet, do not investigate, decide or answer");
    expect(nudge).toContain('get-messages tool, threadId "t1"');
    expect(nudge).toContain("never fill gaps from your own head");
  });

  it("the nudge says what to do with a question the thread does not answer: yours, or bob's", () => {
    expect(nudge).toContain("yours to answer from this repo under their direction, or bob's to answer");
    expect(nudge).toContain("draft that question for them with send-to-peer");
    expect(nudge).toContain("only what your user decided");
  });

  it("the tool descriptions the agent sees carry the same rules", async () => {
    const { seen } = await Effect.runPromise(converse([{ text: "…" }], ["Continue."]));
    const byName = Object.fromEntries(seen[0]!.tools.map((t) => [t.name, t.description]));
    expect(byName["get-messages"]).toContain("never fill gaps from your own head");
    expect(byName["get-messages"]).toContain("the person on this side decides");
    expect(byName["send-to-peer"]).toContain("send only what your user asked you to send");
    expect(byName["send-to-peer"]).toContain("send only what your user asked you to send");
    expect(seen[0]!.prompt).toContain(nudge);
  });
});

describe("the tools, under an agent that follows the rules", () => {
  const script: ReadonlyArray<Turn> = [
    // 1. the headline, nothing read
    { text: "bob asks you to address ask-review on sandbox. Want the details?" },
    // 2. the person asks — read from collagen
    { calls: [{ name: "get-messages", params: { threadId: "t1" } }], text: "bob: average([2,4]) returns NaN, suspects the loop bound, asks you to confirm before Friday." },
    // 3. the person decides — send exactly that
    {
      calls: [{ name: "send-to-peer", params: { peer: "bob", project: "sandbox", intent: "reply", findings: "Confirmed: i <= length. Fix lands Monday." } }],
      text: "Queued for your approval.",
    },
    // 4. the person asks something the thread can't answer — bob's to answer, so a question is drafted
    {
      calls: [{ name: "send-to-peer", params: { peer: "bob", project: "sandbox", intent: "ask", findings: "Which branch are you seeing this on?" } }],
      text: "The thread doesn't say; I've drafted the question to bob for your approval.",
    },
  ];
  const turns = ["Continue.", "what does he say exactly?", "reply: confirmed, it's the loop bound, fix lands Monday", "which branch is he on?"];

  it("headline turn: nothing is read, the message still waits", async () => {
    const { responses } = await Effect.runPromise(converse(script, turns));
    expect(responses[0]!.calls).toEqual([]);
    expect(responses[0]!.pending).toBe(1);
    expect(responses[0]!.outbox).toEqual([]);
  });

  it("asked for details: get-messages returns bob's words and marks the thread seen", async () => {
    const { responses } = await Effect.runPromise(converse(script, turns));
    expect(responses[1]!.calls).toEqual([{ name: "get-messages", params: { threadId: "t1" } }]);
    expect(responses[1]!.results[0]).toContain("average([2,4]) returns NaN");
    expect(responses[1]!.pending).toBe(0);
  });

  it("the person's reply goes out verbatim, and is recorded as having gone", async () => {
    const { responses, sent } = await Effect.runPromise(converse(script, turns));
    expect(sent[0]).toEqual({ kind: "message", peer: "bob", project: "sandbox", intent: "reply", findings: "Confirmed: i <= length. Fix lands Monday." });
    expect(responses[2]!.outbox).toHaveLength(1);
    expect(responses[2]!.outbox[0]!.outgoing).toMatchObject({ kind: "message", peer: "bob", findings: "Confirmed: i <= length. Fix lands Monday." });
  });

  it("a question the thread can't answer becomes a question to bob, in the same words", async () => {
    const { responses, sent } = await Effect.runPromise(converse(script, turns));
    expect(responses[3]!.outbox).toHaveLength(2);
    // newest first: the question is the record on top
    expect(responses[3]!.outbox[0]!.outgoing).toMatchObject({ kind: "message", intent: "ask", findings: "Which branch are you seeing this on?" });
    expect(sent.map((x) => (x.kind === "message" ? x.intent : x.kind))).toEqual(["reply", "ask"]);
  });
});
