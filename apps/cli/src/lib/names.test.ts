import { describe, expect, it } from "vitest";
import { personNamed, projectSpelling, resolveName, roomRollCall } from "./names";

const ME = "m".repeat(64);
const JUICY = { key: "j".repeat(64), name: "Juicy" };
const BOB = { key: "b".repeat(64), name: "bob", away: true };
const CAROL = { key: "c".repeat(64), name: "carol" };

describe("resolveName", () => {
  it("matches however it is cased, trimmed", () => {
    const r = resolveName("  juicy ", [[JUICY, BOB]]);
    expect(r).toEqual({ _tag: "found", value: JUICY });
  });

  it("an exact spelling wins over a case-only twin", () => {
    const twin = { key: "x".repeat(64), name: "juicy" };
    expect(resolveName("Juicy", [[JUICY, twin]], (p) => p.key)).toEqual({ _tag: "found", value: JUICY });
  });

  it("refuses to pick between two holders that differ by case alone", () => {
    const a = { key: "1", name: "Juicy" };
    const b = { key: "2", name: "JUICY" };
    expect(resolveName("juicy", [[a, b]], (p) => p.key)).toEqual({ _tag: "ambiguous", names: ["Juicy", "JUICY"] });
  });

  it("the same person in two pools is one match", () => {
    expect(resolveName("JUICY", [[JUICY], [{ key: JUICY.key, name: "Juicy" }]], (p) => p.key)._tag).toBe("found");
  });

  it("forgives case, nothing fuzzier", () => {
    expect(resolveName("juic", [[JUICY]])._tag).toBe("missing");
  });
});

describe("personNamed", () => {
  const room = { peers: [JUICY, BOB], members: [JUICY, CAROL, { key: ME, name: "me" }], me: ME };

  it("finds a remembered member who is offline", () => {
    expect(personNamed("Carol", room)).toEqual({ _tag: "found", person: CAROL });
  });

  it("a miss names the room", () => {
    const r = personNamed("dave", room);
    expect(r).toEqual({ _tag: "refused", text: "failed: no one here is called dave — in the room: Juicy, bob (away), carol (offline)" });
  });

  it("self is a candidate only where the site allows it", () => {
    expect(personNamed("ME", { ...room, members: [] })._tag).toBe("refused");
    expect(personNamed("ME", { ...room, self: { key: ME, name: "me" } })).toEqual({ _tag: "found", person: { key: ME, name: "me" } });
  });
});

describe("roomRollCall", () => {
  it("says so when nobody else is here", () => {
    expect(roomRollCall([], [{ key: ME, name: "me" }], ME)).toBe("nobody else is in this room yet");
  });
});

describe("projectSpelling", () => {
  it("takes the room's spelling, and keeps a name nobody shares as typed", () => {
    expect(projectSpelling("Collagen", [], [{ name: "collagen" }])).toBe("collagen");
    expect(projectSpelling(" API ", [{ projects: [{ name: "api" }] }], [])).toBe("api");
    expect(projectSpelling("other ", [], [])).toBe("other");
  });
});
