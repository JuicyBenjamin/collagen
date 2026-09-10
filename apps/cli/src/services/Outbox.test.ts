import { afterEach, describe, expect, it } from "vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import type { LocalState, Outgoing } from "@collagen/p2p";
import { Dispatch } from "./Dispatch";
import { editable, Outbox, proposalText, QUEUED_TEXT } from "./Outbox";
import { StateStore } from "./StateStore";

/** An in-memory StateStore with the given preferred ai (and any outbox left from "before"). */
const stateWith = (preferredAi: string | null, outbox?: LocalState["outbox"]) =>
  Layer.effect(
    StateStore,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<LocalState>({ preferredAi, rooms: {}, ...(outbox ? { outbox } : {}) });
      return {
        state,
        get: SubscriptionRef.get(state),
        update: (f: (s: LocalState) => LocalState) => SubscriptionRef.update(state, f),
      } as const;
    }),
  );

/** A Dispatch that records what it was asked to send instead of touching a room. */
const recording = () => {
  const sent: Array<{ roomId: string; out: Outgoing }> = [];
  const layer = Layer.succeed(Dispatch, {
    perform: (roomId: string, out: Outgoing) => Effect.sync(() => (sent.push({ roomId, out }), `sent ${out.kind}`)),
  } as const);
  return { sent, layer };
};

const run = <A>(preferredAi: string | null, body: (o: Outbox["Service"]) => Effect.Effect<A>, outbox?: LocalState["outbox"]) => {
  const d = recording();
  const result = Effect.runPromise(
    Effect.gen(function* () {
      return yield* body(yield* Outbox);
    }).pipe(Effect.provide(Outbox.layer.pipe(Layer.provide(stateWith(preferredAi, outbox)), Layer.provide(d.layer)))),
  );
  return result.then((value) => ({ value, sent: d.sent }));
};

const message = {
  roomId: "r1",
  to: "alice",
  title: "sandbox · ask",
  outgoing: { kind: "message", peer: "alice", project: "sandbox", intent: "ask", findings: "why NaN?" } as const,
};

describe("Outbox — human in the loop, sending side", () => {
  afterEach(() => {
    delete process.env.COLLAGEN_AUTO_APPROVE;
  });

  it("a real agent's send is queued, not sent, and the agent is told so", async () => {
    const { value, sent } = await run("claude-code", (o) =>
      Effect.gen(function* () {
        const text = yield* o.propose(message);
        return { text, pending: yield* o.all };
      }),
    );
    expect(value.text).toBe(QUEUED_TEXT);
    expect(sent).toHaveLength(0);
    expect(value.pending).toHaveLength(1);
    expect(value.pending[0]).toMatchObject({ roomId: "r1", to: "alice", title: "sandbox · ask", outgoing: message.outgoing });
    expect(proposalText(value.pending[0]!)).toBe("why NaN?");
  });

  it("no ai set is still a person: gated", async () => {
    const { value } = await run(null, (o) => o.propose(message));
    expect(value).toBe(QUEUED_TEXT);
  });

  it("approve dispatches it once and clears it", async () => {
    const { value, sent } = await run("codex", (o) =>
      Effect.gen(function* () {
        yield* o.propose(message);
        const [p] = yield* o.all;
        const outcome = yield* o.approve(p!.id);
        const again = yield* o.approve(p!.id);
        return { outcome, again, left: yield* o.all };
      }),
    );
    expect(value.outcome).toBe("sent message");
    expect(sent).toEqual([{ roomId: "r1", out: message.outgoing }]);
    expect(value.again).toBe("gone");
    expect(value.left).toHaveLength(0);
  });

  it("reject drops it without sending", async () => {
    const { value, sent } = await run("codex", (o) =>
      Effect.gen(function* () {
        yield* o.propose(message);
        yield* o.propose({ roomId: "r1", to: "bob", title: "sandbox · fix NaN", outgoing: { kind: "settle", ticketId: "t", stepId: "s1", result: "done", failed: false } });
        const [first] = yield* o.all;
        yield* o.reject(first!.id);
        return yield* o.all;
      }),
    );
    expect(sent).toHaveLength(0);
    expect(value).toHaveLength(1);
    expect(value[0]!.outgoing.kind).toBe("settle");
  });

  it("edit changes the words that leave — message findings, a step's result; not a ticket", async () => {
    const ticket = {
      roomId: "r1",
      to: "bob",
      title: "sandbox · goal",
      outgoing: {
        kind: "ticket",
        ticket: { id: "t", project: "sandbox", goal: "goal", createdBy: "me", kind: "task", updatedAt: 1, steps: [{ id: "s1", owner: "k", intent: "do", description: "it", needs: [], status: "pending", updatedAt: 1 }] },
      } as const,
    };
    const { value, sent } = await run("codex", (o) =>
      Effect.gen(function* () {
        yield* o.propose(message);
        yield* o.propose(ticket);
        const [m, t] = yield* o.all;
        yield* o.edit(m!.id, "why does average() return NaN for [2,4]? — alice");
        yield* o.edit(t!.id, "ignored");
        const after = yield* o.all;
        yield* o.approve(m!.id);
        return { after, editableFlags: after.map(editable) };
      }),
    );
    expect(value.editableFlags).toEqual([true, false]);
    expect(proposalText(value.after[1]!)).toBe("s1 · do: it");
    expect(sent[0]!.out).toMatchObject({ kind: "message", findings: "why does average() return NaN for [2,4]? — alice" });
  });

  it("proposals persisted from before are still there after a restart", async () => {
    const left = [{ ...message, id: "p-old", ts: 1 }];
    const { value, sent } = await run("codex", (o) =>
      Effect.gen(function* () {
        const before = yield* o.all;
        yield* o.approve("p-old");
        return before;
      }), left);
    expect(value).toHaveLength(1);
    expect(sent).toEqual([{ roomId: "r1", out: message.outgoing }]);
  });

  it("a transcript proposal reads as what it is and is not editable", async () => {
    const { value } = await run("codex", (o) =>
      Effect.gen(function* () {
        yield* o.propose({
          roomId: "r1",
          to: "alice",
          title: "ticket-1234 · thread t1 · your codex conversation",
          outgoing: { kind: "transcript", requestId: "q", subject: "ticket-1234", requester: "alicekey", threadId: "t1", ai: "codex", sessionId: "019c0000-0000-7000-8000-000000000abc", since: Date.parse("2026-09-09T10:00:00.000Z") },
        });
        const [p] = yield* o.all;
        return { text: proposalText(p!), editable: editable(p!) };
      }),
    );
    expect(value.text).toContain("your codex conversation 019c0000… on thread t1, from 2026-09-09T10:00:00.000Z on");
    expect(value.text).toContain("It goes to the requester only");
    expect(value.editable).toBe(false);
  });

  it("a review proposal shows the person their own words before they leave", async () => {
    const { value } = await run("claude-code", (o) =>
      Effect.gen(function* () {
        yield* o.propose({
          roomId: "r1",
          to: "kristian",
          title: "collagen · review · review opening",
          outgoing: {
            kind: "review",
            ticket: { id: "t1", project: "collagen", goal: "review opening", createdBy: "me", kind: "review", updatedAt: 1, steps: [] },
            review: {
              ticketId: "t1",
              author: "me",
              authorName: "benjamin",
              summary: "the logo starts centred and glides into the header",
              branch: "opening",
              base: "main",
              link: "https://github.com/JuicyBenjamin/collagen/pull/22",
              decisions: [{ id: "d1", what: "pure frame functions", userWhy: "make it look cool", agentWhy: "testable frame by frame", where: ["src/lib/logoFrame.ts:60"] }],
              forks: [{ id: "f1", at: "src/components/Logo/Logo.tsx:87", chose: "setInterval", instead: "the Timeline animator", why: "no new dependency", by: "agent" }],
              ts: 1,
            },
          },
        });
        const [p] = yield* o.all;
        return { text: proposalText(p!), editable: editable(p!) };
      }),
    );
    expect(value.text).toContain('a review of "review opening"');
    expect(value.text).toContain("opening → main · https://github.com/JuicyBenjamin/collagen/pull/22");
    // the quoted steering is the sensitive half — it must be on screen
    expect(value.text).toContain("you: make it look cool");
    expect(value.text).toContain("agent: testable frame by frame");
    expect(value.text).toContain("this goes on the room's log for everyone in it");
    expect(value.text).toContain("f1 src/components/Logo/Logo.tsx:87: chose setInterval over the Timeline animator — no new dependency (agent's call)");
    expect(value.editable).toBe(false);
  });

  it("a mocked agent is not a person: dispatched straight away", async () => {
    const { value, sent } = await run("mock:codex", (o) => o.propose(message));
    expect(value).toBe("sent message");
    expect(sent).toHaveLength(1);
  });

  it("COLLAGEN_AUTO_APPROVE=1 (tests only) bypasses the gate", async () => {
    process.env.COLLAGEN_AUTO_APPROVE = "1";
    const { value } = await run("claude-code", (o) => o.propose(message));
    expect(value).toBe("sent message");
  });
});
