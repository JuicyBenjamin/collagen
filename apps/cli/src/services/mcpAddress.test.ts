import { describe, expect, it } from "vitest";
import { mcpServerName, portForProfile } from "./mcpAddress";

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
