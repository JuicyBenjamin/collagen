import { describe, expect, it } from "vitest";
import { isRoomId, shortRoomId } from "./topic";

describe("isRoomId", () => {
  it("accepts uuids, rejects everything else", () => {
    expect(isRoomId("0198a111-2222-7333-8444-555566667777")).toBe(true);
    expect(isRoomId("0198A111-2222-7333-8444-555566667777")).toBe(true);
    expect(isRoomId("")).toBe(false);
    expect(isRoomId("cat")).toBe(false);
    expect(isRoomId("0198a111-2222-7333-8444-55556666777")).toBe(false); // one short
    expect(isRoomId(" 0198a111-2222-7333-8444-555566667777")).toBe(false); // stray space
    expect(isRoomId("0198a1112222733384445555666677 77")).toBe(false); // no dashes
  });
});

describe("shortRoomId", () => {
  it("is stable, 8 hex chars, and independent of the room's label", () => {
    const a = shortRoomId("0198a111-2222-7333-8444-555566667777");
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(shortRoomId("0198a111-2222-7333-8444-555566667777")).toBe(a);
  });
});
