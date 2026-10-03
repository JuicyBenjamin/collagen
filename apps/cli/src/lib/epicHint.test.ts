import { describe, expect, it } from "vitest";
import { moveToEpic, turnEpic, type Ticket } from "@collagen/p2p";
import { relatedHint } from "./epicHint";

const t = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, project: "collagen", goal: id, createdBy: "me", kind: "proposal", steps: [], structureAt: 1, updatedAt: 1, ...over });
const room = (...ts: ReadonlyArray<Ticket>) => new Map(ts.map((x) => [x.id, x]));
const HOUR = 60 * 60_000;

describe("what the agent is told about epics as a ticket is filed", () => {
  it("a lineage of four, none in an epic: a candidate for a new epic, for the agent to judge", () => {
    const languages = t("languages");
    const php = t("php", { from: ["languages"] });
    const rust = t("rust", { from: ["languages"] });
    const go = t("go", { from: ["languages"] });
    // three is not enough any more
    expect(relatedHint(rust, room(languages, php, rust), "me")).toBe("");
    const hint = relatedHint(go, room(languages, php, rust, go), "me");
    expect(hint).toMatch(/4 of your user's open tickets share one lineage/);
    expect(hint).toMatch(/"go" \[go\]/);
    expect(hint).toMatch(/only on their yes/);
    expect(hint).toMatch(/Only if they are plainly about the same topic — otherwise say nothing/);
  });

  it("filed close together in one project proves nothing: no offer, however many", () => {
    const a = t("a", { filedAt: 1000 });
    const b = t("b", { filedAt: 2000 });
    const c = t("c", { filedAt: 3000 });
    const d = t("d", { filedAt: 4000 });
    expect(relatedHint(d, room(a, b, c, d), "me")).toBe("");
    // others' tickets never count toward your lineage
    const root = t("root");
    const kids = ["x", "y"].map((id) => t(id, { from: ["root"], createdBy: "bob" }));
    expect(relatedHint(t("z", { from: ["root"] }), room(root, ...kids, t("z", { from: ["root"] })), "me")).toBe("");
  });

  it("a ticket grown out of one in an epic is offered that epic to judge, not put there; parents in two epics ask which", () => {
    const e = t("e", { kind: "epic", project: "", title: "More languages", goal: "the review page reads more languages" });
    const php = moveToEpic(t("php"), "e", "me", 1);
    const plan = t("plan", { from: ["php"], structureAt: 5 * HOUR });
    const hint = relatedHint(plan, room(e, php, plan), "me");
    expect(hint).toMatch(/grows out of a ticket in the epic "More languages" \[e\].*not put there on its own/);
    expect(hint).toMatch(/otherwise say nothing/);
    const e2 = t("e2", { kind: "epic", project: "", goal: "Backoffice" });
    const lint = moveToEpic(t("lint"), "e2", "me", 2);
    const both = t("both", { from: ["php", "lint"], structureAt: 9 * HOUR });
    expect(relatedHint(both, room(e, e2, php, lint, both), "me")).toMatch(/grows out of tickets in 2 epics .*which/);
  });

  it("otherwise the room's open epics, for a ticket that plainly fits one — and nothing when there are none", () => {
    const e = t("e", { kind: "epic", project: "", title: "Better Review Experience" });
    // an epic closes by a turn: an empty one, closed with a reason
    const open = t("c", { kind: "epic", project: "", title: "Done" });
    const turned = turnEpic(open, true, "nothing in it", "me", room(open), 1);
    if (turned.outcome !== "turned") throw new Error(`could not close the fixture epic: ${turned.outcome}`);
    const hint = relatedHint(t("n"), room(e, turned.ticket, t("n")), "me");
    expect(hint).toMatch(/EPICS open in the room: "Better Review Experience" \[e\]\. If this ticket plainly belongs to one/);
    expect(hint).not.toMatch(/Done/);
    expect(relatedHint(t("n"), room(t("n")), "me")).toBe("");
  });

  it("nothing once it is in an epic, or for an epic itself", () => {
    const e = t("e", { kind: "epic", project: "" });
    const a = moveToEpic(t("a"), "e", "me", 1);
    expect(relatedHint(a, room(e, a), "me")).toBe("");
    expect(relatedHint(e, room(e), "me")).toBe("");
  });
});
