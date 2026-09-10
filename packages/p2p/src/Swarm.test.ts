import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./schema";
import { protocolOf } from "./Swarm";

describe("a frame we cannot read", () => {
  it("still says which protocol version wrote it, whatever else it holds", () => {
    // a greet from a build that speaks another version: unreadable as an
    // Envelope, but the version has to survive or the peer just never appears
    const older = JSON.stringify({
      topic: "ab".repeat(32),
      frame: { kind: "profile", profile: { name: "kristian", protocol: "1", ai: "codex", projects: [] } },
    });
    expect(protocolOf(older)).toBe("1");
    expect(protocolOf(older)).not.toBe(PROTOCOL_VERSION);
  });

  it("says nothing when there is nothing to say", () => {
    expect(protocolOf("not json")).toBe(null);
    expect(protocolOf(JSON.stringify({ topic: "x", frame: { kind: "log-info", key: "k" } }))).toBe(null);
    expect(protocolOf(JSON.stringify({ frame: { profile: { protocol: 2 } } }))).toBe(null);
  });
});
