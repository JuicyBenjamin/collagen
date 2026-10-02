import { describe, expect, it } from "vitest";
import { moveToEpic, type Ticket } from "@collagen/p2p";
import { relatedHint } from "./epicHint";

const t = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, project: "collagen", goal: id, createdBy: "me", kind: "proposal", steps: [], structureAt: 1, updatedAt: 1, ...over });
const room = (...ts: ReadonlyArray<Ticket>) => new Map(ts.map((x) => [x.id, x]));
const HOUR = 60 * 60_000;

describe("offering an epic for tickets filed together", () => {
  it("a third ticket grown out of the same one: offer, naming all three", () => {
    const languages = t("languages");
    const php = t("php", { from: ["languages"], structureAt: 5 * HOUR });
    const rust = t("rust", { from: ["languages"], structureAt: 9 * HOUR });
    expect(relatedHint(php, room(languages, php), "me")).toBe("");
    const hint = relatedHint(rust, room(languages, php, rust), "me");
    expect(hint).toMatch(/3 related tickets together \(rust, (languages|php), (languages|php)\)/);
    expect(hint).toMatch(/only on their yes/);
  });

  it("three in one project within half an hour count too; older ones, others' and other projects' do not", () => {
    const a = t("a", { structureAt: 1000 });
    const b = t("b", { structureAt: 2000 });
    const c = t("c", { structureAt: 3000 });
    expect(relatedHint(c, room(a, b, c), "me")).toMatch(/3 related tickets/);
    expect(relatedHint(c, room(t("a", { structureAt: 3000 - HOUR }), b, c), "me")).toBe("");
    expect(relatedHint(c, room(t("a", { createdBy: "bob", structureAt: 1000 }), b, c), "me")).toBe("");
    expect(relatedHint(c, room(t("a", { project: "other", structureAt: 1000 }), b, c), "me")).toBe("");
  });

  it("nothing once they are in an epic, or for an epic itself", () => {
    const e = t("e", { kind: "epic", project: "" });
    const a = moveToEpic(t("a", { structureAt: 1000 }), "e", "me", 1);
    const b = t("b", { structureAt: 2000 });
    const c = t("c", { structureAt: 3000 });
    expect(relatedHint(c, room(e, a, b, c), "me")).toBe("");
    expect(relatedHint(e, room(e, b, c), "me")).toBe("");
  });
});
