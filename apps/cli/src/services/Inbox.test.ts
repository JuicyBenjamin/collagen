import { describe, expect, it } from "vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import type { LocalState, RoomMessage } from "@collagen/p2p";
import { Inbox, wantsPerson } from "./Inbox";
import { StateStore } from "./StateStore";

const message = (intent: string): RoomMessage => ({
  id: intent,
  threadId: "t",
  from: "b",
  fromName: "bob",
  to: "a",
  project: "p",
  intent,
  findings: "…",
  ts: 1,
});

describe("wantsPerson", () => {
  it("a peer's message and a step that became yours ask the person to act", () => {
    expect(wantsPerson(message("flag-issue"))).toBe(true);
    expect(wantsPerson(message("ticket-step:review"))).toBe(true);
  });

  it("a ticket moving is the agent's context, not the person's job", () => {
    expect(wantsPerson(message("ticket-update:settled"))).toBe(false);
    expect(wantsPerson(message("ticket-update:revised the why"))).toBe(false);
  });
});

describe("each AI conversation keeps its own place in a thread", () => {
  const said = (id: string, sentAt: number): RoomMessage => ({
    id,
    threadId: "t",
    from: "b",
    fromName: "bob",
    to: "a",
    project: "p",
    intent: `say ${id}`,
    findings: "…",
    ts: sentAt,
  });
  const inbox = Effect.gen(function* () {
    return yield* Inbox;
  }).pipe(
    Effect.provide(
      Inbox.layer.pipe(
        Layer.provide(
          Layer.effect(
            StateStore,
            Effect.gen(function* () {
              const state = yield* SubscriptionRef.make<LocalState>({
                preferredAi: null,
                rooms: {},
              });
              return {
                state,
                get: SubscriptionRef.get(state),
                update: (change: (s: LocalState) => LocalState) =>
                  SubscriptionRef.update(state, change),
              } as unknown as StateStore["Service"];
            }),
          ),
        ),
      ),
    ),
  );
  const ids = (messages: ReadonlyArray<RoomMessage>) => messages.map((message) => message.id);

  it("what one conversation read is still news to another, and a new one starts at the tail", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const box = yield* inbox;
        yield* box.push("r", said("m1", 1), 1);
        yield* box.push("r", said("m2", 2), 2);
        const claude = yield* box.read("r", "t", "claude-code:s1");
        yield* box.push("r", said("m3", 3), 3);
        const claudeAgain = yield* box.read("r", "t", "claude-code:s1");
        // codex comes to the thread after everything was read by someone
        const codex = yield* box.read("r", "t", "codex:th1");
        yield* box.push("r", said("m4", 4), 4);
        const codexPending = yield* box.pendingFor("r", "codex:th1");
        const codexAgain = yield* box.read("r", "t", "codex:th1");
        return { claude, claudeAgain, codex, codexPending, codexAgain };
      }),
    );
    // first read: what nobody had read yet, as news
    expect(ids(result.claude.messages)).toEqual(["m1", "m2"]);
    expect(result.claude.first).toBe(true);
    // its place moved: only what came after
    expect(ids(result.claudeAgain.messages)).toEqual(["m3"]);
    expect(result.claudeAgain.first).toBe(false);
    // new to the thread: nothing as news, the last messages as a catch-up
    expect(ids(result.codex.messages)).toEqual([]);
    expect(ids(result.codex.before)).toEqual(["m1", "m2", "m3"]);
    // and from then on, its own place
    expect(result.codexPending.map((row) => row.count)).toEqual([1]);
    expect(ids(result.codexAgain.messages)).toEqual(["m4"]);
  });
});
