import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ToolId } from "@collagen/review-web/data";

// The language servers behind the review page's type hints, one per
// language, each installed on the person's word rather than shipped: the
// cli carries a pinned version and where to get it, the page offers it, and
// nothing changes until they say yes. Pinned exact, so what answers a hover
// never moves under anyone; installed into collagen's own folder (never the
// project's) from npm's registry, its package's install scripts not run.
// A server only ever READS the branch under review — none is configured to
// build or run it.

export interface LanguageTool {
  readonly id: ToolId;
  /** For the person: the offer's "Installs <name> <version> (<size>)". */
  readonly name: string;
  readonly package: string;
  /** Moving it is a change of its own: the next install fetches the new
   *  one beside the old. */
  readonly version: string;
  readonly size: string;
  /** Said in the offer when the tool is not open source. */
  readonly licence?: { readonly name: string; readonly url: string };
  /** Points at an existing package instead (tests, an offline machine). */
  readonly env: string;
  /** The server's entry, relative to the package. */
  readonly bin: string;
  readonly args: ReadonlyArray<string>;
  /** The LSP languageId of a file it is asked about. */
  readonly languageId: (ext: string) => string;
  /** Where the project keeps what its code imports, linked from the clone
   *  into the review's tree beside each `marker` file. */
  readonly deps: { readonly marker: string; readonly dir: string };
  /** initialize's initializationOptions; `storage` is a folder of the
   *  review's own for whatever the server keeps. */
  readonly initializationOptions?: (storage: string) => unknown;
  /** The answer to the server's workspace/configuration, per item. */
  readonly settings?: unknown;
  /** The server says it is ready to answer (its index is built): until then
   *  a first question waits, up to a minute. Absent: ready at once. */
  readonly readyWhen?: (method: string, params: unknown) => boolean;
}

export const TOOLS: Readonly<Record<ToolId, LanguageTool>> = {
  typescript: {
    id: "typescript",
    name: "TypeScript",
    package: "typescript",
    version: "7.0.2",
    size: "about 30 MB",
    env: "COLLAGEN_TYPESCRIPT",
    bin: "bin/tsc",
    args: ["--lsp", "--stdio"],
    languageId: (ext) => (ext === ".tsx" ? "typescriptreact" : ext === ".jsx" ? "javascriptreact" : ext.includes("js") ? "javascript" : "typescript"),
    deps: { marker: "package.json", dir: "node_modules" },
  },
};

/** Where a pinned tool lives under collagen's config folder. */
export const toolRoot = (configDir: string, tool: LanguageTool): string => join(configDir, "tools", `${tool.package}-${tool.version}`);

/** The installed package's folder — or the one the tool's env names. */
export const packageDir = (configDir: string, tool: LanguageTool, env: NodeJS.ProcessEnv = process.env): string =>
  env[tool.env] ?? join(toolRoot(configDir, tool), "node_modules", tool.package);

/** Installed, and the version pinned? A different version in the folder is
 *  not it — the pin is the point. */
export function installed(dir: string, tool: LanguageTool, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!existsSync(join(dir, tool.bin))) return false;
  if (env[tool.env]) return true;
  try {
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string }).version === tool.version;
  } catch {
    return false;
  }
}

/** The npm command that installs it: the exact version, into `root`, no
 *  lockfile or audit noise, and no install scripts. */
export const installArgs = (root: string, tool: LanguageTool): ReadonlyArray<string> => [
  "install",
  "--prefix",
  root,
  "--no-save",
  "--no-package-lock",
  "--no-audit",
  "--no-fund",
  "--ignore-scripts",
  "--loglevel=error",
  `${tool.package}@${tool.version}`,
];

/** Run the install; resolves with null when it worked, or what went wrong. */
export function install(root: string, tool: LanguageTool): Promise<string | null> {
  return new Promise((resolve) => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    let err = "";
    const npm = spawn(process.platform === "win32" ? "npm.cmd" : "npm", [...installArgs(root, tool)], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    npm.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-2000)));
    npm.on("error", (e) => resolve(`npm did not start: ${e.message}`));
    npm.on("exit", (code) => resolve(code === 0 ? null : `npm install failed (exit ${code})${err.trim() ? `: ${err.trim().split("\n").slice(-3).join(" ")}` : ""}`));
  });
}
