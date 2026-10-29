import { describe, expect, it } from "vitest";
import type { Conversation, LocalState } from "@collagen/p2p";
import { listenerFor, withWorked } from "./worked";

describe("your own AIs carry work between them", () => {
  const planner: Conversation = { ai: "claude-code", id: "planner-session" };
  const builder: Conversation = { ai: "codex", id: "builder-thread" };
  const base: LocalState = { preferredAi: null, rooms: {} };
  // the builder worked on the ticket earlier, the planner most recently
  const state = withWorked(withWorked(base, builder, { tickets: ["ticket-1"] }, 1), planner, { tickets: ["ticket-1"] }, 2);

  it("what one conversation did reaches another that worked on it, never itself", () => {
    expect(listenerFor(state, { threadId: "thread-1", ticketId: "ticket-1", conversation: planner })?.conversation).toEqual(builder);
    expect(listenerFor(state, { threadId: "thread-1", ticketId: "ticket-1", conversation: builder })?.conversation).toEqual(planner);
  });

  it("the conversation that adopted the thread is passed over when it did it", () => {
    const adopted: LocalState = { ...state, threads: { "thread-1": { ai: "claude-code", sessionId: "planner-session" } as NonNullable<LocalState["threads"]>[string] } };
    expect(listenerFor(adopted, { threadId: "thread-1", ticketId: "ticket-1", conversation: planner })?.conversation).toEqual(builder);
    expect(listenerFor(adopted, { threadId: "thread-1", ticketId: "ticket-1" })?.conversation).toEqual(planner);
  });

  it("with no other conversation on it, nobody is woken", () => {
    const alone = withWorked(base, planner, { tickets: ["ticket-1"] }, 1);
    expect(listenerFor(alone, { threadId: "thread-1", ticketId: "ticket-1", conversation: planner })).toBeUndefined();
  });
});
