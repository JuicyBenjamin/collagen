import type { Decision, Fork, Grouped, Hunk, Unit } from "@collagen/review-web/data";
import { claimed, parsePointer, sameFile } from "./reviewView";

// A review read by units: code that together makes one thing — a component
// with its sub-components, its implementation and its tests — each hunk of
// the diff shown exactly once, read in the order it is built: what
// something is made of before what uses it. The decisions are the why
// beside the units they shaped, not the grouping key: a decision says why,
// a unit says what belongs together, and the two rarely line up one to one.
// Pure: the review, the diff's hunks, and which changed files import which
// (services/ReviewView reads those from the clone).

/** Which changed files each changed file imports. */
export type Imports = ReadonlyMap<string, ReadonlySet<string>>;

interface AuthorUnit {
  readonly id: string;
  readonly title: string;
  readonly where: ReadonlyArray<string>;
}

/** How precisely a pointer claims a hunk: a line beats a whole file. */
const precision = (pointer: string): number => (parsePointer(pointer).line === undefined ? 1 : 2);

/** A file's name, with as much of its folder as tells it apart from the
 *  others: "page.ts", or "jobs/composer.json" beside "composer.json". */
const shortName = (file: string, all: ReadonlyArray<string>): string => {
  const parts = file.split("/");
  for (let n = 1; n <= parts.length; n++) {
    const tail = parts.slice(-n).join("/");
    if (!all.some((f) => f !== file && (f === tail || f.endsWith(`/${tail}`)))) return tail;
  }
  return file;
};

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
 *  what no unit claims joins a unit its file imports or is imported by, and
 *  the rest is grouped by imports among itself. */
export function groupByUnit(
  review: { readonly decisions: ReadonlyArray<Decision>; readonly forks: ReadonlyArray<Fork>; readonly units?: ReadonlyArray<AuthorUnit> },
  hunks: ReadonlyArray<Hunk>,
  imports: Imports,
): Grouped {
  // each hunk's home among the author's units
  const home = new Map<string, { unit: number; precision: number }>();
  (review.units ?? []).forEach((u, i) => {
    for (const w of u.where)
      for (const h of claimed(parsePointer(w), hunks)) {
        const p = precision(w);
        const had = home.get(h.id);
        if (!had || p > had.precision) home.set(h.id, { unit: i, precision: p });
      }
  });
  const named = (review.units ?? []).map((u, i) => ({ id: u.id, title: u.title, by: "author" as const, ids: hunks.filter((h) => home.get(h.id)?.unit === i).map((h) => h.id) }));
  const fileOf = new Map(hunks.map((h) => [h.id, h.file]));
  const filesOf = (ids: ReadonlyArray<string>) => [...new Set(ids.map((id) => fileOf.get(id)!))];
  const owner = ownersOf([...new Set(hunks.map((h) => h.file))], imports);

  // what no unit claims goes with the file it belongs with: into the unit
  // that holds that file (or the file itself), else a unit of its own
  const rest = new Map<string, Array<string>>(); // owning file → hunk ids
  for (const h of hunks) {
    if (home.has(h.id)) continue;
    const root = owner.get(h.file) ?? h.file;
    const into = named.find((u) => filesOf(u.ids).some((f) => f === root || f === h.file));
    if (into) into.ids.push(h.id);
    else rest.set(root, [...(rest.get(root) ?? []), h.id]);
  }
  const roots = [...rest.keys()];
  const inferred = [...rest].map(([root, ids], i) => ({ id: `i${i + 1}`, title: shortName(root, roots), by: "imports" as const, ids }));

  // a file's hunks together inside a unit, in diff order
  const order = new Map(hunks.map((h, i) => [h.id, i]));
  const fileFirst = new Map<string, number>();
  hunks.forEach((h, i) => !fileFirst.has(h.file) && fileFirst.set(h.file, i));
  const tidy = (ids: ReadonlyArray<string>) => [...ids].sort((a, b) => fileFirst.get(fileOf.get(a)!)! - fileFirst.get(fileOf.get(b)!)! || order.get(a)! - order.get(b)!);

  // the why beside each unit: the decisions and forks whose lines fall in it
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

  const all = [...named, ...inferred].filter((u) => u.ids.length > 0).map((u) => ({ ...u, files: filesOf(u.ids) }));
  const units: Array<Unit> = readingOrder(all, imports).map((u) => {
    const ids = tidy(u.ids);
    const mine = new Set(ids);
    return {
      id: u.id,
      title: u.title,
      by: u.by,
      hunks: ids,
      decisions: review.decisions.filter((d) => ids.some((id) => claims.get(id)?.includes(d.id))).map((d) => d.id),
      forks: review.forks.filter((f) => [...forkHunks.get(f.id)!].some((id) => mine.has(id))),
      unexplained: ids.filter((id) => !claims.has(id)),
    };
  });
  const inUnits = new Set(units.flatMap((u) => u.decisions));
  return {
    units,
    hunks,
    unmatched,
    looseForks: review.forks.filter((f) => forkHunks.get(f.id)!.size === 0),
    outside: review.decisions.filter((d) => !inUnits.has(d.id)).map((d) => d.id),
  };
}

/** A file named in a pointer, as the diff spells it — for the import reader. */
export const changedFile = (hunks: ReadonlyArray<Hunk>, path: string): string | undefined => hunks.find((h) => sameFile(h.file, path))?.file;
