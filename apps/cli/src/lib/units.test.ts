import { describe, expect, it } from "vitest";
import type { Hunk } from "@collagen/review-web/data";
import { differing, groupByUnit, ownersOf, uncovered, type Imports } from "./units";

const hunk = (file: string, number: number, newStart: number, newLines = 3): Hunk => ({
  id: `${file}#${number}`,
  file,
  header: "@@",
  newStart,
  newLines,
  lines: Array.from({ length: newLines }, (_, index) => ({ kind: "+" as const, text: `l${index}`, new: newStart + index })),
});
const imports = (pairs: ReadonlyArray<readonly [string, string]>): Imports => {
  const byImporter = new Map<string, Set<string>>();
  for (const [importer, imported] of pairs) byImporter.set(importer, new Set([...(byImporter.get(importer) ?? []), imported]));
  return byImporter;
};
const decision = (id: string, title: string, where: ReadonlyArray<string>) => ({ id, title, what: `${title}, in a line`, where });
const unit = (id: string, title: string, where: ReadonlyArray<string>) => ({ id, title, what: `${title}, in a line`, where });
const line = (grouped: ReturnType<typeof groupByUnit>) => grouped.units.map((section) => `${section.title} [${section.by}]: ${section.hunks.join(" ")}`);

// a routes file with two routes; a page, its test, the rows it uses; notes
const routesA = hunk("src/routes.ts", 0, 10);
const routesB = hunk("src/routes.ts", 1, 400);
const page = hunk("src/page.ts", 2, 1);
const pageTest = hunk("src/page.test.ts", 3, 1);
const rows = hunk("src/rows.ts", 4, 1);
const notes = hunk("notes.txt", 5, 1);

describe("a review in units", () => {
  it("named by the author: titled by what each achieves, a line-precise pointer splitting a file", () => {
    const grouped = groupByUnit({ decisions: [], forks: [], units: [unit("u1", "Exports stream", ["src/routes.ts:11"]), unit("u2", "Imports resume", ["src/routes.ts:401", "src/routes.ts"])] }, [routesA, routesB], new Map());
    expect(line(grouped)).toEqual(["Exports stream [author]: src/routes.ts#0", "Imports resume [author]: src/routes.ts#1"]);
    expect(grouped.units[0]!.what).toBe("Exports stream, in a line");
  });

  it("with no units named: each change under the decision that points at it most precisely, titled by it", () => {
    const grouped = groupByUnit({ decisions: [decision("d1", "Big exports finish", ["src/routes.ts"]), decision("d2", "Imports resume", ["src/routes.ts:401"])], forks: [] }, [routesA, routesB, notes], new Map());
    expect(line(grouped)).toEqual(["Big exports finish [decision]: src/routes.ts#0", "Imports resume [decision]: src/routes.ts#1", "Not explained [unexplained]: notes.txt#5"]);
    // each unit carries every decision that points into it: d1 names the
    // whole file, so the route d2 claims more precisely carries d1 too
    expect(grouped.units[1]!.decisions).toEqual(["d1", "d2"]);
  });

  it("a test is in no unit, even one naming it: it is read apart, with what points into it", () => {
    const withUnit = groupByUnit({ decisions: [], forks: [], units: [unit("u1", "Paging", ["src/page.ts", "src/page.test.ts"])] }, [page, pageTest], imports([["src/page.test.ts", "src/page.ts"]]));
    expect(line(withUnit)).toEqual(["Paging [author]: src/page.ts#2"]);
    expect(withUnit.tests.map((file) => file.file)).toEqual(["src/page.test.ts"]);
    const onlyTests = groupByUnit({ decisions: [decision("d1", "Pages are pinned", ["src/page.test.ts:2"])], forks: [{ id: "f1", at: "src/page.test.ts:1", chose: "a", instead: "b", why: "c" }] }, [pageTest], new Map());
    expect(onlyTests.units).toEqual([]);
    // shown with the tests: neither outside the diff nor loose
    expect(onlyTests.tests[0]!.decisions).toEqual(["d1"]);
    expect(onlyTests.tests[0]!.forks.map((fork) => fork.id)).toEqual(["f1"]);
    expect(onlyTests.outside).toEqual([]);
    expect(onlyTests.looseForks).toEqual([]);
    expect(onlyTests.unmatched).toEqual({});
  });

  it("what nothing points at is one 'Not explained', read last — never a unit named after a file", () => {
    const grouped = groupByUnit({ decisions: [decision("d1", "Rows map to text", ["src/rows.ts"])], forks: [] }, [notes, rows, page], new Map());
    expect(line(grouped)).toEqual(["Rows map to text [decision]: src/rows.ts#4", "Not explained [unexplained]: notes.txt#5 src/page.ts#2"]);
    expect(grouped.units.at(-1)!.unexplained).toEqual(["notes.txt#5", "src/page.ts#2"]);
  });

  it("building blocks first: a unit that uses another comes after it", () => {
    const grouped = groupByUnit({ decisions: [], forks: [], units: [unit("u1", "Pages", ["src/page.ts"]), unit("u2", "Rows", ["src/rows.ts"])] }, [page, rows], imports([["src/page.ts", "src/rows.ts"]]));
    expect(grouped.units.map((section) => section.title)).toEqual(["Rows", "Pages"]);
  });

  it("each change once, forks and stale pointers kept, a decision with no code shown outside", () => {
    const grouped = groupByUnit(
      {
        decisions: [decision("d1", "Both routes", ["src/routes.ts:11", "src/routes.ts:401"]), decision("d2", "Gone", ["src/gone.ts:3"])],
        forks: [{ id: "f1", at: "src/routes.ts:401", chose: "a", instead: "b", why: "c" }, { id: "f2", at: "elsewhere.ts:1", chose: "a", instead: "b", why: "c" }],
        units: [unit("u1", "Exports stream", ["src/routes.ts:11"]), unit("u2", "Imports resume", ["src/routes.ts:401"])],
      },
      [routesA, routesB, notes],
      new Map(),
    );
    const all = grouped.units.flatMap((section) => section.hunks);
    expect(new Set(all).size).toBe(all.length);
    expect(grouped.units.find((section) => section.title === "Imports resume")!.forks.map((fork) => fork.id)).toEqual(["f1"]);
    expect(grouped.units.find((section) => section.title === "Exports stream")!.decisions).toEqual(["d1"]);
    expect(grouped.looseForks.map((fork) => fork.id)).toEqual(["f2"]);
    expect(grouped.unmatched).toEqual({ d2: ["src/gone.ts:3"] });
    expect(grouped.outside).toEqual(["d2"]);
  });
});

describe("what the author's units leave out", () => {
  it("names each file with a change no unit claims, once, in diff order — tests need none", () => {
    const all = [routesA, routesB, page, pageTest, rows, notes];
    expect(uncovered([unit("a", "Signing in works", ["src/routes.ts:10", "src/page.ts"])], all)).toEqual(["src/routes.ts", "src/rows.ts", "notes.txt"]);
    expect(uncovered([unit("a", "Everything", ["src/routes.ts", "src/page.ts", "src/rows.ts", "notes.txt"])], all)).toEqual([]);
  });
});

describe("what a changed file belongs with", () => {
  it("a sub-component below its only user; else itself", () => {
    const files = ["src/Dispatch.ts", "src/Outbox.ts", "src/Tickets/Tickets.tsx", "src/Tickets/components/Row.tsx", "src/mcp.ts"];
    const owners = ownersOf(files, imports([["src/Tickets/Tickets.tsx", "src/Tickets/components/Row.tsx"], ["src/mcp.ts", "src/Outbox.ts"]]));
    expect(owners.get("src/Tickets/components/Row.tsx")).toBe("src/Tickets/Tickets.tsx");
    // a module used from beside it is its own thing
    expect(owners.get("src/Outbox.ts")).toBe("src/Outbox.ts");
  });
});

// a page that swaps its table for the new <DataTable>, each with its own rows
const use = (file: string, rows: string, extra: ReadonlyArray<string> = []): Hunk => {
  const text = [`import { DataTable } from "${file.split("/").length > 3 ? "../../" : "../"}components/DataTable";`, `-  <table>{${rows}.map(renderRow)}</table>`, `+  <DataTable rows={${rows}} />`, ...extra];
  return {
    id: `${file}#0`,
    file,
    header: "@@",
    newStart: 1,
    newLines: text.length,
    lines: text.map((line, index) => (line.startsWith("-") ? { kind: "-" as const, text: line.slice(1), old: index + 1 } : { kind: "+" as const, text: line.startsWith("+") ? line.slice(1) : line, new: index + 1 })),
  };
};

describe("a group of repeated uses", () => {
  const table = hunk("src/components/DataTable.tsx", 0, 1, 20);
  const pages = [use("src/pages/Users.tsx", "users"), use("src/pages/Orders.tsx", "orders"), use("src/pages/admin/Audit.tsx", "entries"), use("src/pages/Teams.tsx", "teams")];

  it("is one unit read right after the unit it uses, whatever order it was named in", () => {
    const grouped = groupByUnit(
      { decisions: [], forks: [], units: [{ ...unit("u2", "Lists use the table", pages.map((page) => page.file)), usesOf: "u1" }, unit("u1", "One table for every list", ["src/components/DataTable.tsx"])] },
      [table, ...pages],
      new Map(),
    );
    expect(grouped.units.map((unit) => unit.id)).toEqual(["u1", "u2"]);
    expect(grouped.units[1]!.uses).toEqual({ of: "u1", differs: [] });
    expect(grouped.units[0]!.uses).toBeUndefined();
  });

  it("names a use that does something of its own, and leads nowhere when the unit it names is gone", () => {
    const odd = use("src/pages/Teams.tsx", "teams", ["  if (!teams.length) return <Empty />;"]);
    const grouped = groupByUnit({ decisions: [], forks: [], units: [{ ...unit("u2", "Lists use the table", [...pages.slice(0, 3), odd].map((page) => page.file)), usesOf: "u9" }] }, [...pages.slice(0, 3), odd], new Map());
    expect(grouped.units[0]!.uses).toEqual({ differs: ["src/pages/Teams.tsx"] });
  });

  it("names a use that left out part of the change or added to it, and both of two that differ each way", () => {
    const short: Hunk = { ...pages[3]!, lines: pages[3]!.lines.slice(1) };
    expect(differing([...pages.slice(0, 3), short])).toEqual(["src/pages/Teams.tsx"]);
    expect(differing(pages)).toEqual([]);
    const odd = use("src/pages/Orders.tsx", "orders", ["  const total = sum(orders);"]);
    expect(differing([pages[0]!, odd])).toEqual(["src/pages/Orders.tsx"]);
    const other = use("src/pages/Users.tsx", "users", ["  if (!users) return null;"]);
    expect(differing([other, odd])).toEqual(["src/pages/Users.tsx", "src/pages/Orders.tsx"]);
    expect(differing([pages[0]!])).toEqual([]);
  });
});
