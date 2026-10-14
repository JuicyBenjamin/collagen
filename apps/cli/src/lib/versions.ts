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

export function parseVersion(text: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(text.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null };
}

/** `latest` is strictly newer than `current`. Unparsable input → false. */
export function isNewer(latest: string, current: string): boolean {
  const latestVersion = parseVersion(latest);
  const currentVersion = parseVersion(current);
  if (!latestVersion || !currentVersion) return false;
  for (const part of ["major", "minor", "patch"] as const) {
    if (latestVersion[part] !== currentVersion[part]) return latestVersion[part] > currentVersion[part];
  }
  if (latestVersion.pre === currentVersion.pre) return false;
  if (latestVersion.pre === null) return true; // 0.2.0 beats 0.2.0-alpha
  if (currentVersion.pre === null) return false;
  return latestVersion.pre > currentVersion.pre;
}
