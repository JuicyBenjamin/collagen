import { describe, expect, it } from "vitest";
import { mcpServerName, portForProfile } from "./mcpAddress";

describe("portForProfile", () => {
  it("is deterministic, mainnet in 41000–44999, devnet in 45000–48999", () => {
    expect(portForProfile("alice", "mainnet")).toBe(portForProfile("alice", "mainnet"));
    for (const p of ["default", "alice", "bob", "p1577"]) {
      const main = portForProfile(p, "mainnet");
      expect(main).toBeGreaterThanOrEqual(41000);
      expect(main).toBeLessThan(45000);
      const dev = portForProfile(p, "devnet");
      expect(dev).toBeGreaterThanOrEqual(45000);
      expect(dev).toBeLessThan(49000);
    }
  });
  it("can never give the two nets one port, whatever the profile", () => {
    // p1577 hashed mainnet and devnet onto the same port when both shared one
    // range with a suffix on the key — the ranges are disjoint now
    expect(portForProfile("p1577", "devnet")).not.toBe(portForProfile("p1577", "mainnet"));
    expect(portForProfile("default", "devnet")).not.toBe(portForProfile("default", "mainnet"));
  });
});

describe("mcpServerName", () => {
  it("is `collagen` for the installed default profile, suffixed otherwise", () => {
    expect(mcpServerName("default", "mainnet")).toBe("collagen");
    expect(mcpServerName("alice", "mainnet")).toBe("collagen-alice");
  });
  it("is `collagen-devnet` for a run from source", () => {
    expect(mcpServerName("default", "devnet")).toBe("collagen-devnet");
    expect(mcpServerName("alice", "devnet")).toBe("collagen-devnet-alice");
  });
});
