import { describe, expect, it } from "vitest";
import type { Hunk } from "@collagen/review-web/data";
import { groupByUnit, ownersOf, uncovered, type Imports } from "./units";

const hunk = (file: string, n: number, newStart: number, newLines = 3): Hunk => ({
  id: `${file}#${n}`,
  file,
  header: "@@",
  newStart,
  newLines,
  lines: Array.from({ length: newLines }, (_, i) => ({ kind: "+" as const, text: `l${i}`, new: newStart + i })),
});
const imports = (pairs: ReadonlyArray<readonly [string, string]>): Imports => {
  const m = new Map<string, Set<string>>();
  for (const [a, b] of pairs) m.set(a, new Set([...(m.get(a) ?? []), b]));
  return m;
};
const decision = (id: string, title: string, where: ReadonlyArray<string>) => ({ id, title, what: `${title}, in a line`, where });
const unit = (id: string, title: string, where: ReadonlyArray<string>) => ({ id, title, what: `${title}, in a line`, where });
const line = (g: ReturnType<typeof groupByUnit>) => g.units.map((u) => `${u.title} [${u.by}]: ${u.hunks.join(" ")}`);

// a routes file with two routes; a page, its test, the rows it uses; notes
const routesA = hunk("src/routes.ts", 0, 10);
const routesB = hunk("src/routes.ts", 1, 400);
const page = hunk("src/page.ts", 2, 1);
const pageTest = hunk("src/page.test.ts", 3, 1);
const rows = hunk("src/rows.ts", 4, 1);
const notes = hunk("notes.txt", 5, 1);

describe("a review in units", () => {
  it("named by the author: titled by what each achieves, a line-precise pointer splitting a file", () => {
    const g = groupByUnit({ decisions: [], forks: [], units: [unit("u1", "Exports stream", ["src/routes.ts:11"]), unit("u2", "Imports resume", ["src/routes.ts:401", "src/routes.ts"])] }, [routesA, routesB], new Map());
    expect(line(g)).toEqual(["Exports stream [author]: src/routes.ts#0", "Imports resume [author]: src/routes.ts#1"]);
    expect(g.units[0]!.what).toBe("Exports stream, in a line");
  });

  it("with no units named: each change under the decision that points at it most precisely, titled by it", () => {
    const g = groupByUnit({ decisions: [decision("d1", "Big exports finish", ["src/routes.ts"]), decision("d2", "Imports resume", ["src/routes.ts:401"])], forks: [] }, [routesA, routesB, notes], new Map());
    expect(line(g)).toEqual(["Big exports finish [decision]: src/routes.ts#0", "Imports resume [decision]: src/routes.ts#1", "Not explained [unexplained]: notes.txt#5"]);
    // each unit carries every decision that points into it: d1 names the
    // whole file, so the route d2 claims more precisely carries d1 too
    expect(g.units[1]!.decisions).toEqual(["d1", "d2"]);
  });

  it("a test goes with its code — into the author's unit, or the decision's — never on its own", () => {
    const withUnit = groupByUnit({ decisions: [], forks: [], units: [unit("u1", "Paging", ["src/page.ts"])] }, [page, pageTest], imports([["src/page.test.ts", "src/page.ts"]]));
    expect(line(withUnit)).toEqual(["Paging [author]: src/page.ts#2 src/page.test.ts#3"]);
    const withDecision = groupByUnit({ decisions: [decision("d1", "A hundred a page", ["src/page.ts"])], forks: [] }, [page, pageTest], imports([["src/page.test.ts", "src/page.ts"]]));
    expect(line(withDecision)).toEqual(["A hundred a page [decision]: src/page.ts#2 src/page.test.ts#3"]);
  });

  it("what nothing points at is one 'Not explained', read last — never a unit named after a file", () => {
    const g = groupByUnit({ decisions: [decision("d1", "Rows map to text", ["src/rows.ts"])], forks: [] }, [notes, rows, page], new Map());
    expect(line(g)).toEqual(["Rows map to text [decision]: src/rows.ts#4", "Not explained [unexplained]: notes.txt#5 src/page.ts#2"]);
    expect(g.units.at(-1)!.unexplained).toEqual(["notes.txt#5", "src/page.ts#2"]);
  });

  it("building blocks first: a unit that uses another comes after it", () => {
    const g = groupByUnit({ decisions: [], forks: [], units: [unit("u1", "Pages", ["src/page.ts"]), unit("u2", "Rows", ["src/rows.ts"])] }, [page, rows], imports([["src/page.ts", "src/rows.ts"]]));
    expect(g.units.map((u) => u.title)).toEqual(["Rows", "Pages"]);
  });

  it("each change once, forks and stale pointers kept, a decision with no code shown outside", () => {
    const g = groupByUnit(
      {
        decisions: [decision("d1", "Both routes", ["src/routes.ts:11", "src/routes.ts:401"]), decision("d2", "Gone", ["src/gone.ts:3"])],
        forks: [{ id: "f1", at: "src/routes.ts:401", chose: "a", instead: "b", why: "c" }, { id: "f2", at: "elsewhere.ts:1", chose: "a", instead: "b", why: "c" }],
        units: [unit("u1", "Exports stream", ["src/routes.ts:11"]), unit("u2", "Imports resume", ["src/routes.ts:401"])],
      },
      [routesA, routesB, notes],
      new Map(),
    );
    const all = g.units.flatMap((u) => u.hunks);
    expect(new Set(all).size).toBe(all.length);
    expect(g.units.find((u) => u.title === "Imports resume")!.forks.map((f) => f.id)).toEqual(["f1"]);
    expect(g.units.find((u) => u.title === "Exports stream")!.decisions).toEqual(["d1"]);
    expect(g.looseForks.map((f) => f.id)).toEqual(["f2"]);
    expect(g.unmatched).toEqual({ d2: ["src/gone.ts:3"] });
    expect(g.outside).toEqual(["d2"]);
  });
});

describe("what the author's units leave out", () => {
  it("names each file with a change no unit claims, once, in diff order", () => {
    const all = [routesA, routesB, page, pageTest, rows, notes];
    expect(uncovered([unit("a", "Signing in works", ["src/routes.ts:10", "src/page.ts"])], all)).toEqual(["src/routes.ts", "src/page.test.ts", "src/rows.ts", "notes.txt"]);
    expect(uncovered([unit("a", "Everything", ["src/routes.ts", "src/page.ts", "src/page.test.ts", "src/rows.ts", "notes.txt"])], all)).toEqual([]);
  });
});

describe("what a changed file belongs with", () => {
  it("a test with the code its name says it tests; a sub-component below its only user; else itself", () => {
    const files = ["src/Dispatch.ts", "src/Outbox.ts", "src/Outbox.test.ts", "src/Tickets/Tickets.tsx", "src/Tickets/components/Row.tsx", "src/mcp.ts"];
    const owners = ownersOf(files, imports([["src/Outbox.test.ts", "src/Dispatch.ts"], ["src/Outbox.test.ts", "src/Outbox.ts"], ["src/Tickets/Tickets.tsx", "src/Tickets/components/Row.tsx"], ["src/mcp.ts", "src/Outbox.ts"]]));
    expect(owners.get("src/Outbox.test.ts")).toBe("src/Outbox.ts");
    expect(owners.get("src/Tickets/components/Row.tsx")).toBe("src/Tickets/Tickets.tsx");
    // a module used from beside it is its own thing
    expect(owners.get("src/Outbox.ts")).toBe("src/Outbox.ts");
  });
});
