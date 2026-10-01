import { describe, expect, it } from "vitest";
import type { RoomMessage } from "@collagen/p2p";
import { wantsPerson } from "./Inbox";

const msg = (intent: string): RoomMessage => ({ id: intent, threadId: "t", from: "b", fromName: "bob", to: "a", project: "p", intent, findings: "…", ts: 1 });

describe("wantsPerson", () => {
  it("a peer's message and a step that became yours ask the person to act", () => {
    expect(wantsPerson(msg("flag-issue"))).toBe(true);
    expect(wantsPerson(msg("ticket-step:review"))).toBe(true);
  });

  it("a ticket moving is the agent's context, not the person's job", () => {
    expect(wantsPerson(msg("ticket-update:settled"))).toBe(false);
    expect(wantsPerson(msg("ticket-update:revised the why"))).toBe(false);
  });
});
