import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** What a repository can tell us about itself, read straight from .git — no
 *  git process, no network. Used to fill in a review's branch and link when
 *  the agent doesn't pass them: the shared project's path is known, so the
 *  facts should not depend on an agent remembering to run a command.
 *  Everything here returns null rather than throwing: a project that is not
 *  a repo is normal. */

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** The repo's git directory for `root`, following the `gitdir:` pointer a
 *  worktree (or a submodule) leaves in place of the folder. */
export const gitDir = (root: string): string | null => {
  const dot = join(root, ".git");
  try {
    if (statSync(dot).isDirectory()) return dot;
  } catch {
    return null;
  }
  const pointer = read(dot)?.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
  if (!pointer) return null;
  return isAbsolute(pointer) ? pointer : resolve(root, pointer);
};

/** Where the repo's shared files live: a worktree's own git dir holds HEAD,
 *  but config and remotes are in the common dir it points at. */
const commonDir = (dir: string): string => {
  const common = read(join(dir, "commondir"))?.trim();
  if (!common) return dir;
  return isAbsolute(common) ? common : resolve(dir, common);
};

/** The checked-out branch, or null when HEAD is detached. */
export const branchOf = (root: string): string | null => {
  const dir = gitDir(root);
  if (!dir) return null;
  return read(join(dir, "HEAD"))?.match(/^ref:\s*refs\/heads\/(.+)$/m)?.[1]?.trim() ?? null;
};

/** The `origin` remote as a browsable https URL (ssh and git forms too), or
 *  null when there is no origin. */
export const repoWebUrl = (root: string): string | null => {
  const dir = gitDir(root);
  if (!dir) return null;
  const config = read(join(commonDir(dir), "config"));
  if (!config) return null;
  const section = config.split(/^\[/m).find((chunk) => /^remote\s+"origin"\]/.test(chunk));
  const url = section?.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!url) return null;
  const strip = (address: string) => address.replace(/\.git$/, "").replace(/\/$/, "");
  const ssh = url.match(/^(?:ssh:\/\/)?(?:git@)([^/:]+)[:/](.+)$/);
  if (ssh) return strip(`https://${ssh[1]}/${ssh[2]}`);
  if (/^https?:\/\//.test(url)) return strip(url);
  return null;
};

/** The branch the repo's code lands on: the one `origin/HEAD` names, else
 *  `main` or `master` when origin has it — null when none is known. */
export const defaultBranchOf = (root: string): string | null => {
  const dir = gitDir(root);
  if (!dir) return null;
  const common = commonDir(dir);
  const head = read(join(common, "refs", "remotes", "origin", "HEAD"))?.match(/^ref:\s*refs\/remotes\/origin\/(.+)$/m)?.[1]?.trim();
  if (head) return head;
  const packed = read(join(common, "packed-refs")) ?? "";
  const has = (branch: string) => read(join(common, "refs", "remotes", "origin", branch)) !== null || packed.split("\n").some((line) => line.endsWith(` refs/remotes/origin/${branch}`));
  return ["main", "master"].find(has) ?? null;
};
