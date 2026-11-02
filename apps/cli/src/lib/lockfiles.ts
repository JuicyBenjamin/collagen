// A review's lockfiles, read apart from its code. A lockfile changes by
// thousands of lines nobody wrote; what a reviewer asks of it is only which
// packages moved, and whether that followed from the change. So it is read
// as packages, at both ends — added, removed, or from one version to
// another — and its lines stay one click away. Pure: services/ReviewView
// reads the texts.

/** A lockfile, by its name: the package managers collagen reads, and the ones it only sets apart. */
const LOCKFILES: Readonly<Record<string, Format | null>> = {
  "pnpm-lock.yaml": "pnpm",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "yarn.lock": "yarn",
  "Cargo.lock": "cargo",
  "bun.lock": null,
  "bun.lockb": null,
  "composer.lock": null,
  "Gemfile.lock": null,
  "poetry.lock": null,
  "uv.lock": null,
  "go.sum": null,
};

type Format = "pnpm" | "npm" | "yarn" | "cargo";

const baseName = (file: string): string => file.slice(file.lastIndexOf("/") + 1);

/** A lockfile of a package manager collagen knows, by its name. */
export const isLockfile = (file: string): boolean => baseName(file) in LOCKFILES;

/** One package as the change moves it: the versions it had and has (none: not there). */
export interface PackageChange {
  readonly name: string;
  readonly before: ReadonlyArray<string>;
  readonly after: ReadonlyArray<string>;
}

/** Every package and its versions, as a lockfile's text has them; null when the format is not one collagen reads. */
export const packagesOf = (file: string, text: ReadonlyArray<string>): ReadonlyMap<string, ReadonlySet<string>> | null => {
  const format = LOCKFILES[baseName(file)];
  if (!format) return null;
  const found = new Map<string, Set<string>>();
  const add = (name: string, version: string) => {
    if (!name || !version) return;
    found.set(name, (found.get(name) ?? new Set()).add(version));
  };
  if (format === "npm") {
    try {
      const parsed = JSON.parse(text.join("\n")) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
      for (const [path, entry] of Object.entries(parsed.packages ?? {})) {
        const at = path.lastIndexOf("node_modules/");
        if (at >= 0 && entry.version) add(path.slice(at + "node_modules/".length), entry.version);
      }
      for (const [name, entry] of Object.entries(parsed.dependencies ?? {})) if (entry.version && !found.has(name)) add(name, entry.version);
    } catch {
      return null;
    }
    return found;
  }
  if (format === "pnpm") {
    // the entries under packages: (v9 also repeats them under snapshots:),
    // "  name@1.2.3:", "  '@scope/name@1.2.3':", "  /name@1.2.3:" (v6), a peer suffix "(…)" left off
    let inPackages = false;
    for (const line of text) {
      if (/^\S/.test(line)) inPackages = line === "packages:";
      if (!inPackages) continue;
      const entry = /^ {2}['"]?\/?((?:@[^/@\s'"]+\/)?[^@\s'"/]+)@([^(:'"\s]+)/.exec(line);
      if (entry) add(entry[1]!, entry[2]!);
    }
    return found;
  }
  if (format === "yarn") {
    // a block per resolution: its keys on an unindented line, its version beneath
    let names: ReadonlyArray<string> = [];
    for (const line of text) {
      if (/^\S/.test(line) && line.endsWith(":") && !line.startsWith("#")) {
        names = line
          .slice(0, -1)
          .split(",")
          .map((key) => key.trim().replace(/^"|"$/g, ""))
          .map((key) => key.slice(0, key.indexOf("@", 1)))
          .filter((name, index, all) => name && all.indexOf(name) === index);
        continue;
      }
      const version = /^ {2}version:? "?([^"\s]+)"?/.exec(line);
      if (version) for (const name of names) add(name, version[1]!);
    }
    return found;
  }
  // cargo: [[package]] blocks, a name and a version in each
  let name = "";
  for (const line of text) {
    if (line === "[[package]]") name = "";
    const named = /^name = "([^"]+)"/.exec(line);
    if (named) name = named[1]!;
    const versioned = /^version = "([^"]+)"/.exec(line);
    if (versioned && name) add(name, versioned[1]!);
  }
  return found;
};

/** The packages a lockfile's change moves, by name: added, removed, or a
 *  version changed; null when its format is not one collagen reads, or a
 *  side of it cannot be read. `before` is null for a file the change adds. */
export const packageChanges = (file: string, after: ReadonlyArray<string> | null, before: ReadonlyArray<string> | null): ReadonlyArray<PackageChange> | null => {
  const now = after === null ? new Map<string, ReadonlySet<string>>() : packagesOf(file, after);
  const was = before === null ? new Map<string, ReadonlySet<string>>() : packagesOf(file, before);
  if (now === null || was === null) return null;
  const sorted = (versions: ReadonlySet<string> | undefined) => [...(versions ?? [])].sort();
  return [...new Set([...was.keys(), ...now.keys()])]
    .sort()
    .map((name) => ({ name, before: sorted(was.get(name)), after: sorted(now.get(name)) }))
    .filter((change) => change.before.join(" ") !== change.after.join(" "));
};
