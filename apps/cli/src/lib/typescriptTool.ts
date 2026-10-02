import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// TypeScript for the review page's type hints, installed on the person's
// word rather than shipped: the cli carries a pinned version and where to
// get it, the page offers to fetch it, and nothing else changes until they
// say yes. Pinned exact, so what answers a hover never moves under anyone;
// installed into collagen's own folder (never the project's) from npm's
// registry, its package's install scripts not run.

/** The one TypeScript the review page runs. Moving it is a change of its
 *  own: the next install fetches the new one beside the old. */
export const TYPESCRIPT_VERSION = "7.0.2";

/** Where the pinned TypeScript lives under collagen's config folder. */
export const toolRoot = (configDir: string): string => join(configDir, "tools", `typescript-${TYPESCRIPT_VERSION}`);

/** The installed package's folder: COLLAGEN_TYPESCRIPT points at an
 *  existing typescript package instead (tests, or an offline machine). */
export const packageDir = (configDir: string, env: NodeJS.ProcessEnv = process.env): string =>
  env.COLLAGEN_TYPESCRIPT ?? join(toolRoot(configDir), "node_modules", "typescript");

/** Installed, and the version pinned? A different version in the folder is
 *  not it — the pin is the point. */
export function installed(dir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!existsSync(join(dir, "bin", "tsc"))) return false;
  if (env.COLLAGEN_TYPESCRIPT) return true;
  try {
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string }).version === TYPESCRIPT_VERSION;
  } catch {
    return false;
  }
}

/** The npm command that installs it: the exact version, into `root`, no
 *  lockfile or audit noise, and no install scripts. */
export const installArgs = (root: string): ReadonlyArray<string> => [
  "install",
  "--prefix",
  root,
  "--no-save",
  "--no-package-lock",
  "--no-audit",
  "--no-fund",
  "--ignore-scripts",
  "--loglevel=error",
  `typescript@${TYPESCRIPT_VERSION}`,
];

/** Run the install; resolves with null when it worked, or what went wrong. */
export function install(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    let err = "";
    const npm = spawn(process.platform === "win32" ? "npm.cmd" : "npm", [...installArgs(root)], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    npm.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-2000)));
    npm.on("error", (e) => resolve(`npm did not start: ${e.message}`));
    npm.on("exit", (code) => resolve(code === 0 ? null : `npm install failed (exit ${code})${err.trim() ? `: ${err.trim().split("\n").slice(-3).join(" ")}` : ""}`));
  });
}
