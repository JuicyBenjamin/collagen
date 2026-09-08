/** Just enough semver for "is the registry ahead of me": numeric tuple first,
 *  then the pre-release label, where a label sorts below no label
 *  ("0.2.0-alpha" < "0.2.0") and labels compare as strings
 *  ("alpha" < "beta" < "rc"). */
export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: string | null;
}

export function parseVersion(s: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(s.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

/** `latest` is strictly newer than `current`. Unparsable input → false. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return a[k] > b[k];
  }
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true; // 0.2.0 beats 0.2.0-alpha
  if (b.pre === null) return false;
  return a.pre > b.pre;
}
