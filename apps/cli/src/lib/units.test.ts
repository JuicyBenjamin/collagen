import { describe, expect, it } from "vitest";
import type { Hunk } from "@collagen/review-web/data";
import { groupByUnit, type Imports } from "./units";

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
const decision = (id: string, where: ReadonlyArray<string>) => ({ id, title: id, what: id, where });

// a routes file with two routes, each its own unit; a page and its test
const routesA = hunk("src/routes.ts", 0, 10);
const routesB = hunk("src/routes.ts", 1, 400);
const page = hunk("src/page.ts", 2, 1);
const pageTest = hunk("src/page.test.ts", 3, 1);
const rows = hunk("src/rows.ts", 4, 1);
const notes = hunk("notes.txt", 5, 1);
const hunks = [routesA, routesB, page, pageTest, rows, notes];

describe("a review in units", () => {
  it("each hunk once: a line-precise pointer splits a file across units", () => {
    const g = groupByUnit(
      { decisions: [], forks: [], units: [{ id: "u1", title: "Export route", where: ["src/routes.ts:11"] }, { id: "u2", title: "Import route", where: ["src/routes.ts:401", "src/routes.ts"] }] },
      [routesA, routesB],
      new Map(),
    );
    expect(g.units.map((u) => `${u.title}: ${u.hunks.join(" ")}`)).toEqual(["Export route: src/routes.ts#0", "Import route: src/routes.ts#1"]);
    const all = g.units.flatMap((u) => u.hunks);
    expect(new Set(all).size).toBe(all.length);
  });

  it("what no unit claims joins the unit it imports from or is imported by — a test with its code", () => {
    const g = groupByUnit({ decisions: [], forks: [], units: [{ id: "u1", title: "Paging", where: ["src/page.ts"] }] }, [page, pageTest], imports([["src/page.test.ts", "src/page.ts"]]));
    expect(g.units).toHaveLength(1);
    expect(g.units[0]!.hunks).toEqual(["src/page.ts#2", "src/page.test.ts#3"]);
  });

  it("with no units named: a test with its code, a sub-component with its component, the rest one each", () => {
    const tickets = hunk("src/Tickets/Tickets.tsx", 6, 1);
    const row = hunk("src/Tickets/components/Row.tsx", 7, 1);
    const g = groupByUnit(
      { decisions: [], forks: [] },
      [page, pageTest, rows, notes, tickets, row],
      // rows sits beside page: its own thing; Row sits below Tickets, and only Tickets uses it
      imports([["src/page.test.ts", "src/page.ts"], ["src/page.ts", "src/rows.ts"], ["src/Tickets/Tickets.tsx", "src/Tickets/components/Row.tsx"]]),
    );
    expect(g.units.map((u) => `${u.title}: ${u.hunks.join(" ")}`)).toEqual([
      "rows.ts: src/rows.ts#4",
      "page.ts: src/page.ts#2 src/page.test.ts#3",
      "notes.txt: notes.txt#5",
      "Tickets.tsx: src/Tickets/Tickets.tsx#6 src/Tickets/components/Row.tsx#7",
    ]);
  });

  it("a test goes with the code its name says it tests, whatever else it imports", () => {
    const dispatch = hunk("src/Dispatch.ts", 9, 1);
    const outbox = hunk("src/Outbox.ts", 10, 1);
    const outboxTest = hunk("src/Outbox.test.ts", 11, 1);
    const g = groupByUnit({ decisions: [], forks: [] }, [dispatch, outbox, outboxTest], imports([["src/Outbox.test.ts", "src/Dispatch.ts"], ["src/Outbox.test.ts", "src/Outbox.ts"], ["src/Outbox.ts", "src/Dispatch.ts"]]));
    expect(g.units.map((u) => `${u.title}: ${u.hunks.join(" ")}`)).toEqual(["Dispatch.ts: src/Dispatch.ts#9", "Outbox.ts: src/Outbox.ts#10 src/Outbox.test.ts#11"]);
  });

  it("a unit of its own is named by its file, with as much folder as tells two apart", () => {
    const g = groupByUnit({ decisions: [], forks: [] }, [hunk("composer.json", 12, 1), hunk("jobs/composer.json", 13, 1), page], new Map());
    expect(g.units.map((u) => u.title)).toEqual(["composer.json", "jobs/composer.json", "page.ts"]);
  });

  it("a file used by two others is its own unit — a hub never swallows the change", () => {
    const a = hunk("src/a.ts", 7, 1);
    const b = hunk("src/b.ts", 8, 1);
    const g = groupByUnit({ decisions: [], forks: [] }, [rows, a, b], imports([["src/a.ts", "src/rows.ts"], ["src/b.ts", "src/rows.ts"]]));
    expect(g.units.map((u) => u.title)).toEqual(["rows.ts", "a.ts", "b.ts"]);
  });

  it("building blocks first: a unit that uses another comes after it", () => {
    const g = groupByUnit(
      { decisions: [], forks: [], units: [{ id: "u1", title: "Page", where: ["src/page.ts"] }, { id: "u2", title: "Rows", where: ["src/rows.ts"] }] },
      [page, rows],
      imports([["src/page.ts", "src/rows.ts"]]),
    );
    expect(g.units.map((u) => u.title)).toEqual(["Rows", "Page"]);
  });

  it("the why beside each unit: its decisions, a decision spanning units under each, and what no decision covers", () => {
    const g = groupByUnit(
      {
        decisions: [decision("d1", ["src/routes.ts:11", "src/routes.ts:401"]), decision("d2", ["src/gone.ts:3"])],
        forks: [{ id: "f1", at: "src/routes.ts:401", chose: "a", instead: "b", why: "c" }, { id: "f2", at: "elsewhere.ts:1", chose: "a", instead: "b", why: "c" }],
        units: [{ id: "u1", title: "Export route", where: ["src/routes.ts:11"] }, { id: "u2", title: "Import route", where: ["src/routes.ts:401"] }],
      },
      hunks,
      new Map(),
    );
    const byTitle = new Map(g.units.map((u) => [u.title, u]));
    expect(byTitle.get("Export route")!.decisions).toEqual(["d1"]);
    expect(byTitle.get("Import route")!.decisions).toEqual(["d1"]);
    expect(byTitle.get("Import route")!.forks.map((f) => f.id)).toEqual(["f1"]);
    expect(g.looseForks.map((f) => f.id)).toEqual(["f2"]);
    expect(g.unmatched).toEqual({ d2: ["src/gone.ts:3"] });
    // a decision whose code is in no change is not lost: it is outside the units
    expect(g.outside).toEqual(["d2"]);
    expect(byTitle.get("Export route")!.unexplained).toEqual([]);
    expect(g.units.find((u) => u.hunks.includes("notes.txt#5"))!.unexplained).toEqual(["notes.txt#5"]);
  });
});
