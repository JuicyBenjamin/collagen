import type { Decision, Fork, Grouped, Hunk, Unit } from "@collagen/review-web/data";
import { claimed, parsePointer, sameFile } from "./reviewView";

// A review read by units: code that together achieves one thing — a
// component with its sub-components, its implementation and its tests —
// each hunk of the diff shown exactly once, titled by what it achieves and
// read in the order it is built: what something is made of before what uses
// it. The author's agent names the units; what it leaves out goes under the
// decision that points at it, so every section still says what it is for;
// what nothing points at is "Not explained". Each unit carries the decisions
// that shaped it — its why.
// Pure: the review, the diff's hunks, and which changed files import which
// (services/ReviewView reads those from the clone).

/** Which changed files each changed file imports. */
export type Imports = ReadonlyMap<string, ReadonlySet<string>>;

interface AuthorUnit {
  readonly id: string;
  readonly title: string;
  readonly what?: string;
  readonly where: ReadonlyArray<string>;
}

/** How precisely a pointer claims a hunk: a line beats a whole file. */
const precision = (pointer: string): number => (parsePointer(pointer).line === undefined ? 1 : 2);

/** A test file, by its name or its folder. */
const isTest = (file: string): boolean => /\.(test|spec)\.[a-z]+$/i.test(file) || /(^|\/)(tests?|__tests__)\//.test(file);

/** The file each changed file belongs with, by imports: a test with the
 *  code it tests; a file in a folder below the one changed file importing
 *  it with that one (a component's sub-components); every other file with
 *  itself — a module used from beside it is its own thing, whoever else
 *  outside the change uses it too. Followed to the end, so a part of a
 *  part lands with the file that uses them. */
export const ownersOf = (files: ReadonlyArray<string>, imports: Imports): ReadonlyMap<string, string> => {
  const importers = (f: string) => files.filter((g) => g !== f && imports.get(g)?.has(f));
  const step = (f: string): string => {
    if (isTest(f)) {
      // the code it tests: the one its name says (Outbox.test.ts → Outbox.ts), else the first it imports
      const subject = f.replace(/\.(test|spec)(\.[a-z]+)$/i, "$2");
      const used = [...(imports.get(f) ?? [])].filter((g) => files.includes(g) && !isTest(g));
      return used.find((g) => g === subject) ?? files.find((g) => g === subject) ?? used[0] ?? f;
    }
    const by = importers(f).filter((g) => !isTest(g));
    const dir = (x: string) => x.slice(0, x.lastIndexOf("/") + 1);
    return by.length === 1 && dir(f).startsWith(dir(by[0]!)) && dir(f) !== dir(by[0]!) ? by[0]! : f;
  };
  const out = new Map<string, string>();
  for (const f of files) {
    let at = f;
    const seen = new Set<string>([f]);
    for (let next = step(at); next !== at && !seen.has(next); next = step(at)) {
      seen.add(next);
      at = next;
    }
    out.set(f, at);
  }
  return out;
};

/** Units in reading order: one before another when the other's files import
 *  its files — building blocks first. Ties, and cycles, keep the given order. */
const readingOrder = <U extends { readonly files: ReadonlyArray<string> }>(units: ReadonlyArray<U>, imports: Imports): ReadonlyArray<U> => {
  const uses = (a: U, b: U) => a !== b && a.files.some((f) => b.files.some((g) => imports.get(f)?.has(g)));
  const left = [...units];
  const out: Array<U> = [];
  while (left.length > 0) {
    // the first unit that uses nothing still unread; in a cycle, the first one
    const next = left.find((u) => !left.some((v) => uses(u, v))) ?? left[0]!;
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
};

/** Lay a diff out in units. Each hunk goes to the author's unit that claims
 *  it most precisely (a line over a whole file; the first unit on a tie);
 *  what no unit claims goes with the file it belongs with (a test, a
 *  sub-component) when that is in a unit, else under the decision that
 *  claims it most precisely; the rest is "Not explained", last. */
export function groupByUnit(
  review: { readonly decisions: ReadonlyArray<Decision>; readonly forks: ReadonlyArray<Fork>; readonly units?: ReadonlyArray<AuthorUnit> },
  hunks: ReadonlyArray<Hunk>,
  imports: Imports,
): Grouped {
  // each hunk's home among a list of claimants (units, or decisions): the
  // one whose pointer claims it most precisely, the first on a tie
  const homes = (claimants: ReadonlyArray<{ readonly where: ReadonlyArray<string> }>): Map<string, number> => {
    const best = new Map<string, { at: number; precision: number }>();
    claimants.forEach((c, i) => {
      for (const w of c.where)
        for (const h of claimed(parsePointer(w), hunks)) {
          const p = precision(w);
          const had = best.get(h.id);
          if (!had || p > had.precision) best.set(h.id, { at: i, precision: p });
        }
    });
    return new Map([...best].map(([id, b]) => [id, b.at]));
  };
  const fileOf = new Map(hunks.map((h) => [h.id, h.file]));
  const filesOf = (ids: ReadonlyArray<string>) => [...new Set(ids.map((id) => fileOf.get(id)!))];
  const owner = ownersOf([...new Set(hunks.map((h) => h.file))], imports);

  // the author's units first
  const unitHome = homes(review.units ?? []);
  const named = (review.units ?? []).map((u, i) => ({ id: u.id, title: u.title, what: u.what ?? "", by: "author" as const, ids: hunks.filter((h) => unitHome.get(h.id) === i).map((h) => h.id) }));

  // what they leave out: a test or a sub-component with the code it belongs
  // to, if that is in a unit; else under the decision that points at it most
  // precisely — the section is that decision, titled by it, so the page
  // still reads by purpose; a test with its code there too. What no decision
  // covers is "Not explained", read last.
  const decisionHome = homes(review.decisions);
  const byDecision = review.decisions.map((d) => ({ id: `d-${d.id}`, title: d.title ?? d.what, what: d.title ? d.what : "", by: "decision" as const, ids: [] as Array<string> }));
  const unexplainedIds: Array<string> = [];
  const homeOfFile = (file: string): (typeof named)[number] | (typeof byDecision)[number] | undefined =>
    named.find((u) => filesOf(u.ids).includes(file)) ?? byDecision.find((u) => u.ids.some((id) => fileOf.get(id) === file));
  const rest = hunks.filter((h) => !unitHome.has(h.id));
  // first the changes a decision points at, so their files have a home
  for (const h of rest) {
    const root = owner.get(h.file) ?? h.file;
    const withUnit = root !== h.file ? named.find((u) => filesOf(u.ids).includes(root)) : undefined;
    if (withUnit) withUnit.ids.push(h.id);
    else if (decisionHome.has(h.id)) byDecision[decisionHome.get(h.id)!]!.ids.push(h.id);
  }
  // then the rest: with what its file belongs with, or not explained
  for (const h of rest) {
    if (named.some((u) => u.ids.includes(h.id)) || decisionHome.has(h.id)) continue;
    const root = owner.get(h.file) ?? h.file;
    const into = root !== h.file ? homeOfFile(root) : undefined;
    if (into) into.ids.push(h.id);
    else unexplainedIds.push(h.id);
  }

  // a file's hunks together inside a unit, in diff order
  const order = new Map(hunks.map((h, i) => [h.id, i]));
  const fileFirst = new Map<string, number>();
  hunks.forEach((h, i) => !fileFirst.has(h.file) && fileFirst.set(h.file, i));
  const tidy = (ids: ReadonlyArray<string>) => [...ids].sort((a, b) => fileFirst.get(fileOf.get(a)!)! - fileFirst.get(fileOf.get(b)!)! || order.get(a)! - order.get(b)!);

  // the why of each unit: the decisions and forks whose lines fall in it
  const claims = new Map<string, Array<string>>(); // hunk id → decision ids
  const unmatched: Record<string, ReadonlyArray<string>> = {};
  for (const d of review.decisions) {
    const missed: Array<string> = [];
    for (const w of d.where) {
      const got = claimed(parsePointer(w), hunks);
      if (got.length === 0) missed.push(w);
      for (const h of got) if (!claims.get(h.id)?.includes(d.id)) claims.set(h.id, [...(claims.get(h.id) ?? []), d.id]);
    }
    if (missed.length > 0) unmatched[d.id] = missed;
  }
  const forkHunks = new Map(review.forks.map((f) => [f.id, new Set(claimed(parsePointer(f.at), hunks).map((h) => h.id))]));

  const shape = (u: { readonly id: string; readonly title: string; readonly what: string; readonly by: Unit["by"]; readonly ids: ReadonlyArray<string> }): Unit => {
    const ids = tidy(u.ids);
    const mine = new Set(ids);
    return {
      id: u.id,
      title: u.title,
      what: u.what,
      by: u.by,
      hunks: ids,
      decisions: review.decisions.filter((d) => ids.some((id) => claims.get(id)?.includes(d.id))).map((d) => d.id),
      forks: review.forks.filter((f) => [...forkHunks.get(f.id)!].some((id) => mine.has(id))),
      unexplained: ids.filter((id) => !claims.has(id)),
    };
  };
  const ordered = readingOrder(
    [...named, ...byDecision].filter((u) => u.ids.length > 0).map((u) => ({ ...u, files: filesOf(u.ids) })),
    imports,
  );
  const units: Array<Unit> = [
    ...ordered.map(shape),
    ...(unexplainedIds.length > 0 ? [shape({ id: "unexplained", title: "Not explained", what: "Changes no decision covers — worth a question to the author.", by: "unexplained", ids: unexplainedIds })] : []),
  ];
  const inUnits = new Set(units.flatMap((u) => u.decisions));
  return {
    units,
    hunks,
    unmatched,
    looseForks: review.forks.filter((f) => forkHunks.get(f.id)!.size === 0),
    outside: review.decisions.filter((d) => !inUnits.has(d.id)).map((d) => d.id),
  };
}

/** The files with changes no unit claims, in diff order — what the author's
 *  units leave to the page's own grouping. */
export const uncovered = (units: ReadonlyArray<{ readonly where: ReadonlyArray<string> }>, hunks: ReadonlyArray<Hunk>): ReadonlyArray<string> => {
  const covered = new Set(units.flatMap((u) => u.where.flatMap((w) => claimed(parsePointer(w), hunks).map((h) => h.id))));
  return [...new Set(hunks.filter((h) => !covered.has(h.id)).map((h) => h.file))];
};

/** A file named in a pointer, as the diff spells it — for the import reader. */
export const changedFile = (hunks: ReadonlyArray<Hunk>, path: string): string | undefined => hunks.find((h) => sameFile(h.file, path))?.file;
