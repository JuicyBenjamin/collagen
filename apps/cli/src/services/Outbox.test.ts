import { describe, expect, it } from "vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import type { LocalState, Outgoing } from "@collagen/p2p";
import { Dispatch, refused, sent, type Done } from "./Dispatch";
import { outgoingSummary, Outbox, proposalText } from "./Outbox";
import { StateStore } from "./StateStore";

/** An in-memory StateStore (with anything remembered from "before"). */
const stateWith = (sent?: LocalState["sent"]) =>
  Layer.effect(
    StateStore,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<LocalState>({ preferredAi: null, rooms: {}, ...(sent ? { sent } : {}) });
      return {
        state,
        get: SubscriptionRef.get(state),
        update: (f: (s: LocalState) => LocalState) => SubscriptionRef.update(state, f),
      } as const;
    }),
  );

/** A Dispatch that records what it was asked to write instead of touching a
 *  room. `answer` decides what it claims happened. */
const recording = (answer: (out: Outgoing) => Done = (out) => sent(`wrote ${out.kind}`)) => {
  const wrote: Array<{ roomId: string; out: Outgoing }> = [];
  const layer = Layer.succeed(Dispatch, {
    perform: (roomId: string, out: Outgoing) => Effect.sync(() => (wrote.push({ roomId, out }), answer(out))),
  } as const);
  return { wrote, layer };
};

const run = <A>(
  body: (o: Outbox["Service"]) => Effect.Effect<A>,
  kept?: LocalState["sent"],
  answer?: (out: Outgoing) => Done,
) => {
  const d = recording(answer);
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* body(yield* Outbox);
    }).pipe(Effect.provide(Outbox.layer.pipe(Layer.provide(stateWith(kept)), Layer.provide(d.layer)))),
  ).then((value) => ({ value, wrote: d.wrote }));
};

const message = {
  roomId: "r1",
  to: "alice",
  title: "sandbox · ask",
  outgoing: { kind: "message", peer: "alice", project: "sandbox", intent: "ask", findings: "why NaN?" } as const,
};

describe("the outbox — what went out", () => {
  it("sends at once and tells the agent what happened, not what might", async () => {
    const { value, wrote } = await run((o) =>
      Effect.gen(function* () {
        const outcome = yield* o.send(message);
        return { outcome, kept: yield* o.all };
      }),
    );
    // no gate: the agent asked because its person asked
    expect(wrote).toEqual([{ roomId: "r1", out: message.outgoing }]);
    expect(value.outcome).toEqual({ _tag: "sent", text: "wrote message" });
    expect(value.kept).toHaveLength(1);
    expect(value.kept[0]).toMatchObject({ roomId: "r1", to: "alice", title: "sandbox · ask" });
  });

  it("keeps a record of each one, newest first, across a restart", async () => {
    const before = [{ ...message, id: "p-old", ts: 1 }];
    const { value } = await run((o) =>
      Effect.gen(function* () {
        yield* o.send({ ...message, title: "sandbox · ask2" });
        return yield* o.all;
      }), before);
    expect(value.map((p) => p.title)).toEqual(["sandbox · ask2", "sandbox · ask"]);
  });

  it("a row says what it was, which project, who for, and what about", async () => {
    const { value } = await run((o) =>
      Effect.gen(function* () {
        yield* o.send({
          roomId: "r1",
          to: "the room",
          title: "collagen · review · review opening",
          outgoing: {
            kind: "review",
            ticket: { id: "t1", project: "collagen", goal: "review opening", createdBy: "me", kind: "review", updatedAt: 1, steps: [] },
            review: { ticketId: "t1", author: "me", authorName: "benjamin", summary: "the opening animation", decisions: [], forks: [], ts: 1 },
          },
        });
        const [p] = yield* o.all;
        return { summary: outgoingSummary(p!), text: proposalText(p!) };
      }),
    );
    // "the room" is not a person: a row shows no target for it
    expect(value.summary).toEqual({ kind: "review", project: "collagen", target: null, subject: "review opening" });
    expect(value.text).toContain("the opening animation");
  });

  it("a refused write leaves no row: the outbox is what LEFT, not what was tried", async () => {
    const { value, wrote } = await run(
      (o) =>
        Effect.gen(function* () {
          const outcome = yield* o.send(message);
          return { outcome, kept: yield* o.all };
        }),
      undefined,
      () => refused("failed: you are not admitted to this room's log yet"),
    );
    // it was attempted, and the agent is told why it did not happen
    expect(wrote).toHaveLength(1);
    expect(value.outcome._tag).toBe("refused");
    expect(value.outcome.text).toContain("not admitted");
    // …and nothing claims it went
    expect(value.kept).toEqual([]);
  });

  it("tell() hands a relaying caller the text alone", async () => {
    const { value } = await run((o) => o.tell(message));
    expect(value).toBe("wrote message");
  });

  it("a message row names the peer it went to", async () => {
    const { value } = await run((o) =>
      Effect.gen(function* () {
        yield* o.send(message);
        const [p] = yield* o.all;
        return outgoingSummary(p!);
      }),
    );
    expect(value).toEqual({ kind: "message", project: "sandbox", target: "alice", subject: "ask" });
  });
});
