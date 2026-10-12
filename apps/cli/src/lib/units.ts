import type { Decision, Fork, Grouped, Hunk, Unit } from "@collagen/review-web/data";
import { claimed, parsePointer, sameFile } from "./reviewView";

// A review read by units: code that together achieves one thing — a
// component with its sub-components, its implementation and its tests —
// each hunk of the diff shown exactly once, titled by what it achieves and
// read in the order it is built: what something is made of before what uses
// it. The author's agent names the units; what it leaves out goes under the
// decision that points at it, so every section still says what it is for;
// what nothing points at is "Not explained". Each unit carries the decisions
// that shaped it — its why. A group of repeated uses — files that only apply
// another unit's change, each the same way — is a unit too, read right after
// the unit it uses, with the files that do not match the rest named.
// Pure: the review, the diff's hunks, and which changed files import which
// (services/ReviewView reads those from the clone).

/** Which changed files each changed file imports. */
export type Imports = ReadonlyMap<string, ReadonlySet<string>>;

interface AuthorUnit {
  readonly id: string;
  readonly title: string;
  readonly what?: string;
  readonly where: ReadonlyArray<string>;
  readonly usesOf?: string;
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
  const importers = (file: string) => files.filter((other) => other !== file && imports.get(other)?.has(file));
  const step = (file: string): string => {
    if (isTest(file)) {
      // the code it tests: the one its name says (Outbox.test.ts → Outbox.ts), else the first it imports
      const subject = file.replace(/\.(test|spec)(\.[a-z]+)$/i, "$2");
      const used = [...(imports.get(file) ?? [])].filter((candidate) => files.includes(candidate) && !isTest(candidate));
      return used.find((candidate) => candidate === subject) ?? files.find((candidate) => candidate === subject) ?? used[0] ?? file;
    }
    const by = importers(file).filter((importer) => !isTest(importer));
    const dir = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
    return by.length === 1 && dir(file).startsWith(dir(by[0]!)) && dir(file) !== dir(by[0]!) ? by[0]! : file;
  };
  const out = new Map<string, string>();
  for (const file of files) {
    let at = file;
    const seen = new Set<string>([file]);
    for (let next = step(at); next !== at && !seen.has(next); next = step(at)) {
      seen.add(next);
      at = next;
    }
    out.set(file, at);
  }
  return out;
};

/** Units in reading order: one before another when the other's files import
 *  its files — building blocks first. Ties, and cycles, keep the given order. */
const readingOrder = <U extends { readonly files: ReadonlyArray<string> }>(units: ReadonlyArray<U>, imports: Imports): ReadonlyArray<U> => {
  const uses = (unit: U, other: U) => unit !== other && unit.files.some((file) => other.files.some((otherFile) => imports.get(file)?.has(otherFile)));
  const left = [...units];
  const out: Array<U> = [];
  while (left.length > 0) {
    // the first unit that uses nothing still unread; in a cycle, the first one
    const next = left.find((unit) => !left.some((other) => uses(unit, other))) ?? left[0]!;
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
};

/** A line with its strings made alike — import paths differ by folder. */
const stripped = (line: string): string => line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');

/** A line's shape for comparing uses: strings, numbers and spacing made
 *  alike, and every name the files do not mostly share made alike — so
 *  `rows={users}` on one page and `rows={orders}` on the next are one use. */
const shapeOf = (line: string, shared: (word: string) => boolean): string =>
  stripped(line)
    .replace(/\b\d[\w.]*/g, "0")
    .replace(/[A-Za-z_$][\w$]*/g, (word) => (shared(word) ? word : "_"))
    .replace(/\s+/g, " ");

/** The files of a group of repeated uses whose changes are not the same as
 *  the rest's: a changed line most of the files do not have, or one most
 *  have and it lacks, sets a file apart. Of two files that each have what
 *  the other lacks, both are — there is no rest to side with. Cheap and
 *  strict: a use wrapped onto more lines differs too, which only asks the
 *  reader to look. */
export const differing = (hunks: ReadonlyArray<Hunk>): ReadonlyArray<string> => {
  const changed = new Map<string, Array<string>>();
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      if (line.kind === " " || line.text.trim().length === 0) continue;
      const lines = changed.get(hunk.file) ?? [];
      lines.push(`${line.kind}${line.text.trim()}`);
      changed.set(hunk.file, lines);
    }
  const files = [...changed.keys()];
  if (files.length < 2) return [];
  const most = (count: number) => count > files.length / 2;
  const tally = (sets: ReadonlyArray<ReadonlySet<string>>) => {
    const counts = new Map<string, number>();
    for (const set of sets) for (const item of set) counts.set(item, (counts.get(item) ?? 0) + 1);
    return counts;
  };
  const words = tally([...changed.values()].map((lines) => new Set(lines.flatMap((line) => stripped(line).match(/[A-Za-z_$][\w$]*/g) ?? []))));
  const shapes = new Map(files.map((file) => [file, new Set(changed.get(file)!.map((line) => shapeOf(line, (word) => most(words.get(word) ?? 0))))]));
  const spread = tally([...shapes.values()]);
  const common = [...spread].filter(([, count]) => most(count)).map(([shape]) => shape);
  return files.filter((file) => {
    const mine = shapes.get(file)!;
    return [...mine].some((shape) => !most(spread.get(shape)!)) || common.some((shape) => !mine.has(shape));
  });
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
    claimants.forEach((claimant, index) => {
      for (const pointer of claimant.where)
        for (const hunk of claimed(parsePointer(pointer), hunks)) {
          const claimPrecision = precision(pointer);
          const had = best.get(hunk.id);
          if (!had || claimPrecision > had.precision) best.set(hunk.id, { at: index, precision: claimPrecision });
        }
    });
    return new Map([...best].map(([id, claim]) => [id, claim.at]));
  };
  const fileOf = new Map(hunks.map((hunk) => [hunk.id, hunk.file]));
  const filesOf = (ids: ReadonlyArray<string>) => [...new Set(ids.map((id) => fileOf.get(id)!))];
  const owner = ownersOf([...new Set(hunks.map((hunk) => hunk.file))], imports);

  // the author's units first
  const unitHome = homes(review.units ?? []);
  const named = (review.units ?? []).map((unit, index) => ({ id: unit.id, title: unit.title, what: unit.what ?? "", by: "author" as const, usesOf: unit.usesOf, ids: hunks.filter((hunk) => unitHome.get(hunk.id) === index).map((hunk) => hunk.id) }));

  // what they leave out: a test or a sub-component with the code it belongs
  // to, if that is in a unit; else under the decision that points at it most
  // precisely — the section is that decision, titled by it, so the page
  // still reads by purpose; a test with its code there too. What no decision
  // covers is "Not explained", read last.
  const decisionHome = homes(review.decisions);
  const byDecision = review.decisions.map((decision) => ({ id: `d-${decision.id}`, title: decision.title ?? decision.what, what: decision.title ? decision.what : "", by: "decision" as const, usesOf: undefined, ids: [] as Array<string> }));
  const unexplainedIds: Array<string> = [];
  const homeOfFile = (file: string): (typeof named)[number] | (typeof byDecision)[number] | undefined =>
    named.find((unit) => filesOf(unit.ids).includes(file)) ?? byDecision.find((unit) => unit.ids.some((id) => fileOf.get(id) === file));
  const rest = hunks.filter((hunk) => !unitHome.has(hunk.id));
  // first the changes a decision points at, so their files have a home
  for (const hunk of rest) {
    const root = owner.get(hunk.file) ?? hunk.file;
    const withUnit = root !== hunk.file ? named.find((unit) => filesOf(unit.ids).includes(root)) : undefined;
    if (withUnit) withUnit.ids.push(hunk.id);
    else if (decisionHome.has(hunk.id)) byDecision[decisionHome.get(hunk.id)!]!.ids.push(hunk.id);
  }
  // then the rest: with what its file belongs with, or not explained
  for (const hunk of rest) {
    if (named.some((unit) => unit.ids.includes(hunk.id)) || decisionHome.has(hunk.id)) continue;
    const root = owner.get(hunk.file) ?? hunk.file;
    const into = root !== hunk.file ? homeOfFile(root) : undefined;
    if (into) into.ids.push(hunk.id);
    else unexplainedIds.push(hunk.id);
  }

  // a file's hunks together inside a unit, in diff order
  const order = new Map(hunks.map((hunk, index) => [hunk.id, index]));
  const fileFirst = new Map<string, number>();
  hunks.forEach((hunk, index) => !fileFirst.has(hunk.file) && fileFirst.set(hunk.file, index));
  const tidy = (ids: ReadonlyArray<string>) => [...ids].sort((a, b) => fileFirst.get(fileOf.get(a)!)! - fileFirst.get(fileOf.get(b)!)! || order.get(a)! - order.get(b)!);

  // the why of each unit: the decisions and forks whose lines fall in it
  const claims = new Map<string, Array<string>>(); // hunk id → decision ids
  const unmatched: Record<string, ReadonlyArray<string>> = {};
  for (const decision of review.decisions) {
    const missed: Array<string> = [];
    for (const pointer of decision.where) {
      const got = claimed(parsePointer(pointer), hunks);
      if (got.length === 0) missed.push(pointer);
      for (const hunk of got) if (!claims.get(hunk.id)?.includes(decision.id)) claims.set(hunk.id, [...(claims.get(hunk.id) ?? []), decision.id]);
    }
    if (missed.length > 0) unmatched[decision.id] = missed;
  }
  const forkHunks = new Map(review.forks.map((fork) => [fork.id, new Set(claimed(parsePointer(fork.at), hunks).map((hunk) => hunk.id))]));

  const shape = (unit: { readonly id: string; readonly title: string; readonly what: string; readonly by: Unit["by"]; readonly usesOf?: string | undefined; readonly ids: ReadonlyArray<string> }): Unit => {
    const ids = tidy(unit.ids);
    const mine = new Set(ids);
    // a group's unit is named only when it is here to lead to
    const of = unit.usesOf !== undefined && unit.usesOf !== unit.id && named.some((other) => other.id === unit.usesOf && other.ids.length > 0) ? unit.usesOf : undefined;
    return {
      id: unit.id,
      title: unit.title,
      what: unit.what,
      by: unit.by,
      hunks: ids,
      decisions: review.decisions.filter((decision) => ids.some((id) => claims.get(id)?.includes(decision.id))).map((decision) => decision.id),
      forks: review.forks.filter((fork) => [...forkHunks.get(fork.id)!].some((id) => mine.has(id))),
      unexplained: ids.filter((id) => !claims.has(id)),
      ...(unit.usesOf !== undefined ? { uses: { ...(of ? { of } : {}), differs: differing(hunks.filter((hunk) => mine.has(hunk.id))) } } : {}),
    };
  };
  const inOrder = readingOrder(
    [...named, ...byDecision].filter((unit) => unit.ids.length > 0).map((unit) => ({ ...unit, files: filesOf(unit.ids) })),
    imports,
  );
  // a group of uses right after the unit it uses — the real change once, then
  // its copies; a group naming another group stays where its imports put it
  const follows = (group: (typeof inOrder)[number]) => group.usesOf !== undefined && inOrder.some((other) => other !== group && other.id === group.usesOf && other.usesOf === undefined);
  const ordered = inOrder.filter((unit) => !follows(unit)).flatMap((unit) => [unit, ...inOrder.filter((group) => follows(group) && group.usesOf === unit.id)]);
  const units: Array<Unit> = [
    ...ordered.map(shape),
    ...(unexplainedIds.length > 0 ? [shape({ id: "unexplained", title: "Not explained", what: "Changes no decision covers — worth a question to the author.", by: "unexplained", ids: unexplainedIds })] : []),
  ];
  const inUnits = new Set(units.flatMap((unit) => unit.decisions));
  return {
    units,
    hunks,
    unmatched,
    looseForks: review.forks.filter((fork) => forkHunks.get(fork.id)!.size === 0),
    outside: review.decisions.filter((decision) => !inUnits.has(decision.id)).map((decision) => decision.id),
  };
}

/** The files with changes no unit claims, in diff order — what the author's
 *  units leave to the page's own grouping. */
export const uncovered = (units: ReadonlyArray<{ readonly where: ReadonlyArray<string> }>, hunks: ReadonlyArray<Hunk>): ReadonlyArray<string> => {
  const covered = new Set(units.flatMap((unit) => unit.where.flatMap((pointer) => claimed(parsePointer(pointer), hunks).map((hunk) => hunk.id))));
  return [...new Set(hunks.filter((hunk) => !covered.has(hunk.id)).map((hunk) => hunk.file))];
};

/** A file named in a pointer, as the diff spells it — for the import reader. */
export const changedFile = (hunks: ReadonlyArray<Hunk>, path: string): string | undefined => hunks.find((hunk) => sameFile(hunk.file, path))?.file;
