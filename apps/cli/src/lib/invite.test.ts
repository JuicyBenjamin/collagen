import { describe, expect, it } from "vitest";
import { checkInvite } from "./invite";

const id = "0198a111-2222-7333-8444-555566667777";

describe("checkInvite", () => {
  it("accepts an invite for this net and hands back the bare id", () => {
    expect(checkInvite(id, "mainnet")).toEqual({ ok: true, id });
    expect(checkInvite(`devnet-${id}`, "devnet")).toEqual({ ok: true, id });
  });
  it("names the other net instead of waiting on a topic nobody is on", () => {
    const live = checkInvite(`devnet-${id}`, "mainnet");
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.reason).toMatch(/devnet room.*run from source to join/);
    const dev = checkInvite(id, "devnet");
    expect(dev.ok).toBe(false);
    if (!dev.ok) expect(dev.reason).toMatch(/mainnet room.*installed collagen/);
  });
  it("says what an invite looks like when the text is not one", () => {
    const r = checkInvite("cat", "mainnet");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/uuid/);
  });
});
