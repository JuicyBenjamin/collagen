import { describe, expect, it } from "vitest";
import type { LocalState, Peer } from "@collagen/p2p";
import { projectRows } from "../routes/room/projectRows";
import { withProjectOrder } from "./projectOrder";
import { sharedProject } from "./projects";

const peer = (name: string, ...projects: string[]): Peer =>
  ({ key: name, name, protocol: "6", ai: null, aiStatus: "unknown", away: false, projects: projects.map((project) => ({ name: project, path: `/x/${project}` })) }) as Peer;

describe("projects", () => {
  it("one project is one row, however its holders case it", () => {
    const rows = projectRows({ preferredAi: null, rooms: { r: [{ id: "1", name: "Collagen", path: "/me" }] } }, "r", [peer("bob", "collagen"), peer("carol", "COLLAGEN")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Collagen", holders: ["you", "bob", "carol"] });
  });

  it("a project peers share that you lack is a row with no copy of yours", () => {
    const rows = projectRows({ preferredAi: null, rooms: {} }, "r", [peer("bob", "api")]);
    expect(rows[0]!.mine).toBeUndefined();
  });

  it("projects stand in the order the person put them, and one added later comes last", () => {
    const mine: LocalState = { preferredAi: null, rooms: { r: [{ id: "1", name: "web", path: "/web" }, { id: "2", name: "api", path: "/api" }] } };
    const ordered = withProjectOrder(mine, "r", ["web", "API", "docs"]);
    expect(projectRows(ordered, "r", [peer("bob", "docs", "zeta", "beta")]).map((row) => row.name)).toEqual(["web", "api", "docs", "beta", "zeta"]);
  });

  it("an order given again keeps the place of a project not in it, for when it is back", () => {
    const ordered = withProjectOrder(withProjectOrder({ preferredAi: null, rooms: {} }, "r", ["web", "docs", "api"]), "r", ["api", "web"]);
    expect(ordered.projectOrder).toEqual({ r: ["api", "web", "docs"] });
  });

  it("a located copy takes the room's name for the project, and says who shares it", () => {
    expect(sharedProject("Collagen", [peer("bob", "collagen"), peer("carol", "collagen")])).toEqual({ name: "collagen", holders: ["bob", "carol"] });
    expect(sharedProject("brand-new", [peer("bob", "collagen")])).toBeNull();
  });
});
