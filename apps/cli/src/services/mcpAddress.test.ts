import { describe, expect, it } from "vitest";
import { mcpServerName, portForProfile } from "./mcpAddress";

describe("portForProfile", () => {
  it("is deterministic and in 41000–44999", () => {
    expect(portForProfile("alice", "mainnet")).toBe(portForProfile("alice", "mainnet"));
    for (const p of ["default", "alice", "bob"]) {
      for (const w of ["mainnet", "devnet"] as const) {
        const port = portForProfile(p, w);
        expect(port).toBeGreaterThanOrEqual(41000);
        expect(port).toBeLessThan(45000);
      }
    }
  });
  it("gives the same profile a different port in each net", () => {
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
