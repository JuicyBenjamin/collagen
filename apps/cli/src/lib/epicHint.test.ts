import { describe, expect, it } from "vitest";
import { moveToEpic, turnEpic, type Ticket } from "@collagen/p2p";
import { relatedHint } from "./epicHint";

const makeTicket = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, project: "collagen", goal: id, createdBy: "me", kind: "proposal", steps: [], structureAt: 1, updatedAt: 1, ...over });
const room = (...tickets: ReadonlyArray<Ticket>) => new Map(tickets.map((ticket) => [ticket.id, ticket]));
const HOUR = 60 * 60_000;

describe("what the agent is told about epics as a ticket is filed", () => {
  it("a lineage of four, none in an epic: a candidate for a new epic, for the agent to judge", () => {
    const languages = makeTicket("languages");
    const php = makeTicket("php", { from: ["languages"] });
    const rust = makeTicket("rust", { from: ["languages"] });
    const go = makeTicket("go", { from: ["languages"] });
    // three is not enough any more
    expect(relatedHint(rust, room(languages, php, rust), "me")).toBe("");
    const hint = relatedHint(go, room(languages, php, rust, go), "me");
    expect(hint).toMatch(/4 of your user's open tickets share one lineage/);
    expect(hint).toMatch(/"go" \[go\]/);
    expect(hint).toMatch(/only on their yes/);
    expect(hint).toMatch(/Only if they are plainly about the same topic — otherwise say nothing/);
  });

  it("filed close together in one project proves nothing: no offer, however many", () => {
    const first = makeTicket("a", { filedAt: 1000 });
    const second = makeTicket("b", { filedAt: 2000 });
    const third = makeTicket("c", { filedAt: 3000 });
    const fourth = makeTicket("d", { filedAt: 4000 });
    expect(relatedHint(fourth, room(first, second, third, fourth), "me")).toBe("");
    // others' tickets never count toward your lineage
    const root = makeTicket("root");
    const kids = ["x", "y"].map((id) => makeTicket(id, { from: ["root"], createdBy: "bob" }));
    expect(relatedHint(makeTicket("z", { from: ["root"] }), room(root, ...kids, makeTicket("z", { from: ["root"] })), "me")).toBe("");
  });

  it("grown out of a ticket in one epic: no word (filed into it, or kept out by its filer); parents in two epics ask which", () => {
    const epic = makeTicket("e", { kind: "epic", project: "", title: "More languages", goal: "the review page reads more languages" });
    const php = moveToEpic(makeTicket("php"), "e", "me", 1);
    const plan = makeTicket("plan", { from: ["php"], structureAt: 5 * HOUR });
    expect(relatedHint(plan, room(epic, php, plan), "me")).toBe("");
    const otherEpic = makeTicket("e2", { kind: "epic", project: "", goal: "Backoffice" });
    const lint = moveToEpic(makeTicket("lint"), "e2", "me", 2);
    const both = makeTicket("both", { from: ["php", "lint"], structureAt: 9 * HOUR });
    expect(relatedHint(both, room(epic, otherEpic, php, lint, both), "me")).toMatch(/grows out of tickets in 2 epics .*which/);
  });

  it("otherwise the room's open epics, for a ticket that plainly fits one — and nothing when there are none", () => {
    const epic = makeTicket("e", { kind: "epic", project: "", title: "Better Review Experience" });
    // an epic closes by a turn: an empty one, closed with a reason
    const open = makeTicket("c", { kind: "epic", project: "", title: "Done" });
    const turned = turnEpic(open, true, "nothing in it", "me", room(open), 1);
    if (turned.outcome !== "turned") throw new Error(`could not close the fixture epic: ${turned.outcome}`);
    const hint = relatedHint(makeTicket("n"), room(epic, turned.ticket, makeTicket("n")), "me");
    expect(hint).toMatch(/EPICS open in the room: "Better Review Experience" \[e\]\. If this ticket plainly belongs to one/);
    expect(hint).not.toMatch(/Done/);
    expect(relatedHint(makeTicket("n"), room(makeTicket("n")), "me")).toBe("");
  });

  it("nothing once it is in an epic, or for an epic itself", () => {
    const epic = makeTicket("e", { kind: "epic", project: "" });
    const member = moveToEpic(makeTicket("a"), "e", "me", 1);
    expect(relatedHint(member, room(epic, member), "me")).toBe("");
    expect(relatedHint(epic, room(epic), "me")).toBe("");
  });
});
