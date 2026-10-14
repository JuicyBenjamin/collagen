import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

// Where a language server reads the branch under review: a folder kept per
// clone and language — a "slot" — not per commit. The tree in it moves from
// commit to commit by what changed between them, so a file that did not
// change keeps its time; beside it is the server's own index, kept too. A
// server that indexes a whole project (Intelephense, vendor/ included) so
// reads it once, not on every start: a restart, a new commit or another
// review of the same clone starts from what it already knows. A slot is held
// by one server at a time, across processes (a pid file); a second review
// of the same clone open at once takes the next slot.

/** Unpack a commit of the clone at `projectPath` into `dir`: git archive into
 *  tar, nothing written to the repository. `paths` limits it to those, taken
 *  as names, not patterns. Each file is stamped with the time it is written,
 *  not the commit's: a server that reads by time sees it changed, even when
 *  the tree moves to an older commit or two commits share a second. */
export const unpack = (projectPath: string, commit: string, dir: string, paths: ReadonlyArray<string> = []): Promise<void> =>
  new Promise((resolve, reject) => {
    mkdirSync(dir, { recursive: true });
    const git = spawn("git", ["--literal-pathspecs", "-C", projectPath, "archive", "--format=tar", commit, ...(paths.length ? ["--", ...paths] : [])], { stdio: ["ignore", "pipe", "ignore"] });
    const tar = spawn("tar", ["-x", "-m", "-C", dir], { stdio: ["pipe", "ignore", "ignore"] });
    git.stdout.pipe(tar.stdin);
    const exit = (child: ReturnType<typeof spawn>) => new Promise<number | null>((done, fail) => (child.on("error", fail), child.on("exit", done)));
    Promise.all([exit(git), exit(tar)]).then(
      ([gitExit, tarExit]) => (gitExit === 0 && tarExit === 0 ? resolve() : reject(new Error(`could not unpack ${commit} (${gitExit !== 0 ? `git exit ${gitExit}` : `tar exit ${tarExit}`})`))),
      reject,
    );
  });

/** The files that differ between two commits: changed or added, and gone. */
const changes = (projectPath: string, from: string, to: string): Promise<{ readonly changed: ReadonlyArray<string>; readonly gone: ReadonlyArray<string> } | null> =>
  new Promise((resolve) => {
    const git = spawn("git", ["-C", projectPath, "diff", "--name-status", "--no-renames", "-z", from, to], { stdio: ["ignore", "pipe", "ignore"] });
    const out: Array<Buffer> = [];
    git.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    git.on("error", () => resolve(null));
    git.on("exit", (code) => {
      if (code !== 0) return resolve(null);
      const parts = Buffer.concat(out).toString("utf8").split("\0").filter(Boolean);
      const changed: Array<string> = [];
      const gone: Array<string> = [];
      for (let index = 0; index + 1 < parts.length; index += 2) (parts[index] === "D" ? gone : changed).push(parts[index + 1]!);
      resolve({ changed, gone });
    });
  });

/** A path of the tree that is the tree's own: no folder on the way to it is
 *  a link (the clone's node_modules or vendor/, linked in) — a change there
 *  is never written through into the clone. */
const ownPath = (tree: string, rel: string): boolean => {
  const parts = rel.split("/");
  let at = tree;
  for (const part of parts.slice(0, -1)) {
    at = join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink()) return false;
    } catch {
      return true; // not there yet: made by the unpack, inside the tree
    }
  }
  return true;
};

/** The tree at `tree` made the commit `commit` of the clone: from the commit
 *  it was at (its stamp), only what changed between them, or, with no
 *  usable stamp, whole. */
export async function treeAt(projectPath: string, commit: string, tree: string, stamp: string): Promise<void> {
  let was: string | null = null;
  try {
    was = readFileSync(stamp, "utf8").trim() || null;
  } catch {
    // never unpacked here
  }
  if (was === commit && existsSync(tree)) return;
  // half-moved is never mistaken for a commit: the stamp goes first
  rmSync(stamp, { force: true });
  const moved = was && existsSync(tree) ? await changes(projectPath, was, commit) : null;
  if (moved) {
    for (const rel of [...moved.gone, ...moved.changed]) if (ownPath(tree, rel)) rmSync(join(tree, rel), { force: true, recursive: true });
    const changed = moved.changed.filter((rel) => ownPath(tree, rel));
    for (let start = 0; start < changed.length; start += 200) await unpack(projectPath, commit, tree, changed.slice(start, start + 200));
  } else {
    rmSync(tree, { recursive: true, force: true });
    await unpack(projectPath, commit, tree);
  }
  writeFileSync(stamp, commit);
}

/** Every slot lives here, shared by every collagen process of this user —
 *  not in collagen-review/, where an older collagen keeps a tree per
 *  process and removes anything else it finds. */
export const TREES = (base: string): string => join(base, "collagen-types");
const OLD_TREES = (base: string): string => join(base, "collagen-review");

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The process holding a slot, while it lives. */
const holder = (dir: string): number | null => {
  try {
    const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
  } catch {
    return null;
  }
};

export interface Slot {
  readonly dir: string;
  /** the branch's files, at the commit in `stamp` */
  readonly tree: string;
  readonly stamp: string;
  /** what the server keeps for itself (an index), beside the tree, not in it */
  readonly storage: string;
}

/** Held by this process, by slot folder. */
const held = new Set<string>();

/** The first slot of this clone and language that nobody holds, taken. */
export function claimSlot(base: string, projectPath: string, kind: string): Slot {
  const id = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  for (let slot = 0; ; slot++) {
    const dir = join(TREES(base), `${id}-${kind}-${slot}`);
    if (held.has(dir)) continue;
    mkdirSync(dir, { recursive: true });
    const pid = holder(dir);
    if (pid !== null && pid !== process.pid) continue;
    rmSync(join(dir, "pid"), { force: true });
    try {
      // two processes after the same free slot: one file, made once
      const descriptor = openSync(join(dir, "pid"), "wx");
      writeSync(descriptor, String(process.pid));
      closeSync(descriptor);
    } catch {
      continue;
    }
    held.add(dir);
    const storage = join(dir, "store");
    mkdirSync(storage, { recursive: true });
    return { dir, tree: join(dir, "tree"), stamp: join(dir, "commit"), storage };
  }
}

/** Given back: the next server of this clone takes it, tree and index as they are. */
export function releaseSlot(slot: Slot): void {
  held.delete(slot.dir);
  if (holder(slot.dir) === process.pid) rmSync(join(slot.dir, "pid"), { force: true });
  try {
    // when it was last used, for the sweep
    const now = new Date();
    utimesSync(slot.dir, now, now);
  } catch {
    // swept already
  }
}

/** A slot nobody has used for this long is removed. */
const UNUSED_MS = 14 * 24 * 60 * 60_000;

/** Slots nobody holds and nobody has used for two weeks go; so do the
 *  per-process trees of an older collagen (collagen-review/<pid>) once that
 *  process is gone. */
export function sweepSlots(base: string, now = Date.now()): void {
  const list = (dir: string): Array<string> => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  for (const name of list(OLD_TREES(base))) if (/^\d+$/.test(name) && !alive(Number(name))) rmSync(join(OLD_TREES(base), name), { recursive: true, force: true });
  for (const name of list(TREES(base))) {
    const dir = join(TREES(base), name);
    try {
      if (!held.has(dir) && holder(dir) === null && now - statSync(dir).mtimeMs > UNUSED_MS) rmSync(dir, { recursive: true, force: true });
    } catch {
      // gone under us
    }
  }
}
