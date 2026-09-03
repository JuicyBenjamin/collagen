import { describe, expect, it } from "vitest";
import { isRoomInviteId, mcpServerName, portForProfile, stripArgSeparator } from "./util";

describe("stripArgSeparator", () => {
  it("removes the first bare -- (pnpm forwards it verbatim)", () => {
    expect(stripArgSeparator(["node", "src/index.tsx", "--", "--profile", "alice"])).toEqual([
      "node",
      "src/index.tsx",
      "--profile",
      "alice",
    ]);
  });

  it("passes argv without a separator through unchanged", () => {
    expect(stripArgSeparator(["node", "x", "--profile", "alice"])).toEqual([
      "node",
      "x",
      "--profile",
      "alice",
    ]);
  });

  it("only strips the first separator", () => {
    expect(stripArgSeparator(["node", "x", "--", "a", "--", "b"])).toEqual([
      "node",
      "x",
      "a",
      "--",
      "b",
    ]);
  });
});

describe("portForProfile", () => {
  it("is deterministic and in 41000–44999", () => {
    expect(portForProfile("alice")).toBe(portForProfile("alice"));
    for (const p of ["default", "alice", "bob"]) {
      const port = portForProfile(p);
      expect(port).toBeGreaterThanOrEqual(41000);
      expect(port).toBeLessThan(45000);
    }
  });
});

describe("mcpServerName", () => {
  it("is `collagen` for the default profile, suffixed otherwise", () => {
    expect(mcpServerName("default")).toBe("collagen");
    expect(mcpServerName("alice")).toBe("collagen-alice");
  });
});

describe("isRoomInviteId", () => {
  it("accepts uuids, rejects everything else", () => {
    expect(isRoomInviteId("0198a111-2222-7333-8444-555566667777")).toBe(true);
    expect(isRoomInviteId("0198A111-2222-7333-8444-555566667777")).toBe(true);
    expect(isRoomInviteId("")).toBe(false);
    expect(isRoomInviteId("cat")).toBe(false);
    expect(isRoomInviteId("0198a111-2222-7333-8444-55556666777")).toBe(false); // one short
    expect(isRoomInviteId(" 0198a111-2222-7333-8444-555566667777")).toBe(false); // stray space
    expect(isRoomInviteId("0198a1112222733384445555666677 77")).toBe(false); // no dashes
  });
});
