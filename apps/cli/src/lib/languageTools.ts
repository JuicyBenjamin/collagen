import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ToolId } from "@collagen/review-web/data";

// The language servers behind the review page's type hints, one per
// language, each installed on the person's word rather than shipped: the
// cli carries a pinned version and where to get it, the page offers it, and
// nothing changes until they say yes. Pinned exact, so what answers a hover
// never moves under anyone; installed into collagen's own folder (never the
// project's) — from npm's registry, its package's install scripts not run,
// or as a release binary whose sha256 the cli carries. A server only ever
// READS the branch under review — none is configured to build or run it.

export interface LanguageTool {
  readonly id: ToolId;
  /** For the person: "<language> type hints for this review? Installs
   *  <name> <version> (<size>)" — and "built into <language>". */
  readonly language: string;
  readonly name: string;
  /** The npm package — or, for a `download`, the folder's name. */
  readonly package: string;
  /** Moving it is a change of its own: the next install fetches the new
   *  one beside the old. */
  readonly version: string;
  readonly size: string;
  /** Said in the offer when the tool is not open source. */
  readonly licence?: { readonly name: string; readonly url: string };
  /** Points at an existing package instead (tests, an offline machine) —
   *  for a `download`, at the binary itself. */
  readonly env: string;
  /** The server's entry, relative to the package: a script run on collagen's
   *  Node, or a `download`'s binary, run as it is. */
  readonly bin: string;
  /** Not on npm: a release binary, gzipped, fetched from `url` (`{asset}`
   *  filled in) and checked against its sha256 before it is kept. Per
   *  platform as Node names it (`darwin-arm64`). */
  readonly download?: {
    readonly url: string;
    readonly assets: Readonly<Partial<Record<string, { readonly asset: string; readonly sha256: string }>>>;
  };
  /** What the machine lacks for the server to answer at all (its
   *  toolchain), in a few words; null when nothing. */
  readonly needs?: () => Promise<string | null>;
  readonly args: ReadonlyArray<string>;
  /** The LSP languageId of a file it is asked about. */
  readonly languageId: (ext: string) => string;
  /** Where the project keeps what its code imports, linked from the clone
   *  into the review's tree beside each `marker` file: `dir`, or what the
   *  marker itself says (`dirFrom`, given its text). */
  readonly deps?: { readonly marker: string; readonly dir: string; readonly dirFrom?: (marker: string) => string | null };
  /** Files in the branch its toolchain would obey and that could make it
   *  run something (a cargo config's rustc-wrapper, a toolchain file's
   *  path): removed from the review's unpacked tree, wherever they are. */
  readonly strip?: ReadonlyArray<string>;
  /** Added to the server's environment; `storage` as below. */
  readonly spawnEnv?: (storage: string) => Readonly<Record<string, string>>;
  /** A declaration outside the branch, by where it sits on disk: the
   *  language's own (`builtin`) or a dependency's (`package`), and the
   *  path to show for it. */
  readonly place?: (path: string) => { readonly where: "builtin" | "package"; readonly file: string } | null;
  /** initialize's initializationOptions; `storage` is a folder kept beside
   *  the review's tree for whatever the server keeps (its index), from one
   *  start to the next (lib/typeTrees). */
  readonly initializationOptions?: (storage: string) => unknown;
  /** The answer to the server's workspace/configuration, per item. */
  readonly settings?: unknown;
  /** The server says it is ready to answer (its index is built): until then
   *  its answers are said as partial, with how far it has read. Absent:
   *  ready at once. */
  readonly readyWhen?: (method: string, params: unknown) => boolean;
}

/** composer.json's config.vendor-dir, when it sets one. */
export const composerVendorDir = (text: string): string | null => {
  try {
    const dir = (JSON.parse(text) as { config?: { "vendor-dir"?: unknown } }).config?.["vendor-dir"];
    return typeof dir === "string" && dir.trim() ? dir.trim().replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
};

const run = (command: string, args: ReadonlyArray<string>): Promise<string | null> =>
  new Promise((resolve) => {
    // from the home folder: never a project's rust-toolchain.toml
    execFile(command, [...args], { cwd: homedir(), timeout: 15_000 }, (error, stdout) => resolve(error ? null : stdout.trim()));
  });

/** What rust-analyzer needs of the machine: cargo (it reads a workspace
 *  through `cargo metadata`) and the rust-src component (std's source, for
 *  std's types). */
export async function rustNeeds(): Promise<string | null> {
  const [cargo, sysroot] = await Promise.all([run("cargo", ["--version"]), run("rustc", ["--print", "sysroot"])]);
  const src = sysroot !== null && existsSync(join(sysroot, "lib", "rustlib", "src", "rust", "library"));
  const lacking = [...(cargo === null ? ["cargo"] : []), ...(src ? [] : ["rust-src"])];
  return lacking.length > 0 ? lacking.join(" and ") : null;
}

/** A Rust declaration outside the branch: std's source in the toolchain,
 *  or a crate in cargo's registry or a git checkout of one. */
export function rustPlace(path: string): { readonly where: "builtin" | "package"; readonly file: string } | null {
  const forward = path.replaceAll("\\", "/");
  const std = /\/lib\/rustlib\/src\/rust\/library\/(.+)$/.exec(forward);
  if (std) return { where: "builtin", file: std[1]! };
  const crate = /\/registry\/src\/[^/]+\/(.+)$/.exec(forward) ?? /\/git\/checkouts\/[^/]+\/[^/]+\/(.+)$/.exec(forward);
  return crate ? { where: "package", file: crate[1]! } : null;
}

/** cargo for a review: offline, its target folder the review's own. */
const cargoEnv = (storage: string): Readonly<Record<string, string>> => ({ CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: join(storage, "target") });

export const TOOLS: Readonly<Record<ToolId, LanguageTool>> = {
  typescript: {
    id: "typescript",
    language: "TypeScript",
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
  // Intelephense: runs on the Node collagen already has, no PHP needed. Not
  // open source — hover and go to definition are in its free tier, and the
  // offer says whose licence it is. Its stubs give PHP's own functions and
  // classes; the clone's vendor/ gives Composer packages. Telemetry is off
  // by default and kept off.
  php: {
    id: "php",
    language: "PHP",
    name: "Intelephense",
    package: "intelephense",
    version: "1.18.5",
    size: "about 150 MB",
    licence: { name: "Intelephense's licence", url: "https://intelephense.com/eula" },
    env: "COLLAGEN_INTELEPHENSE",
    bin: "lib/intelephense.js",
    args: ["--stdio"],
    languageId: () => "php",
    // Composer's own setting, when a project moves vendor/ elsewhere
    deps: { marker: "composer.json", dir: "vendor", dirFrom: composerVendorDir },
    initializationOptions: (storage) => ({ storagePath: storage, globalStoragePath: join(storage, "global"), clearCache: false, telemetry: { enabled: false } }),
    settings: { telemetry: { enabled: false } },
    // it indexes the whole workspace (vendor included) before it answers well
    readyWhen: (method, params) =>
      (method === "$/progress" && (params as { value?: { kind?: string } } | null)?.value?.kind === "end") ||
      (method === "window/logMessage" && /Indexing finished/.test(String((params as { message?: unknown } | null)?.message ?? ""))),
  },
  // rust-analyzer: not on npm, so the release binary, pinned by tag and by
  // each platform's sha256. It runs on the reader's own toolchain (cargo,
  // rust-src). It never runs the branch's code: build scripts, proc macros
  // and cargo check are off — so what derives and attribute macros make
  // (serde's impls, tokio::main) has no types on hover. Offline: crates
  // already in the reader's ~/.cargo resolve, nothing is fetched; cargo's
  // target folder is the review's own.
  rust: {
    id: "rust",
    language: "Rust",
    name: "rust-analyzer",
    package: "rust-analyzer",
    version: "2026-09-28",
    size: "about 14 MB",
    env: "COLLAGEN_RUST_ANALYZER",
    bin: "rust-analyzer",
    args: [],
    languageId: () => "rust",
    download: {
      url: "https://github.com/rust-lang/rust-analyzer/releases/download/2026-09-28/{asset}",
      assets: {
        "darwin-arm64": { asset: "rust-analyzer-aarch64-apple-darwin.gz", sha256: "54ec873d8996e2c127d758bf45d4eacb6d3371dae4f6f6d5d3f05cedbae5fd59" },
        "darwin-x64": { asset: "rust-analyzer-x86_64-apple-darwin.gz", sha256: "d032c0eb75e4597cc8ffc35ea4cdbd9eecc8341936b6edac6749e679fc3f0682" },
        "linux-arm64": { asset: "rust-analyzer-aarch64-unknown-linux-gnu.gz", sha256: "03bad9c3dabb0f07a2678d5f9f8f1575a3742ea141506e14b3a26b42a1f896f3" },
        "linux-x64": { asset: "rust-analyzer-x86_64-unknown-linux-gnu.gz", sha256: "23f711d86b5f826e22886f01d7355dc01e0f4c1357dafa29710a95b903b48c85" },
      },
    },
    needs: rustNeeds,
    // cargo's config and toolchain files can name programs to run (a
    // rustc-wrapper, a toolchain's path); rust-analyzer.toml can turn the
    // settings below back on
    strip: [".cargo", "rust-toolchain", "rust-toolchain.toml", "rust-analyzer.toml"],
    spawnEnv: cargoEnv,
    initializationOptions: (storage) => ({
      cargo: {
        buildScripts: { enable: false },
        extraEnv: cargoEnv(storage),
        targetDir: join(storage, "target"),
      },
      procMacro: { enable: false },
      checkOnSave: false,
      diagnostics: { enable: false },
      // a hover is the signature and its doc: no layout, drop glue or doc links
      hover: { memoryLayout: { enable: false }, dropGlue: { enable: false }, links: { enable: false } },
    }),
    place: rustPlace,
    // quiescent: the workspace is loaded and indexed
    readyWhen: (method, params) => method === "experimental/serverStatus" && (params as { quiescent?: unknown } | null)?.quiescent === true,
  },
};

/** Where a pinned tool lives under collagen's config folder. */
export const toolRoot = (configDir: string, tool: LanguageTool): string => join(configDir, "tools", `${tool.package}-${tool.version}`);

/** The installed package's folder — or the one the tool's env names. A
 *  download's is its pinned folder. */
export const packageDir = (configDir: string, tool: LanguageTool, env: NodeJS.ProcessEnv = process.env): string =>
  tool.download ? toolRoot(configDir, tool) : (env[tool.env] ?? join(toolRoot(configDir, tool), "node_modules", tool.package));

/** The file that is the server: a download's binary (or the one its env
 *  names), an npm package's entry. */
export const serverPath = (configDir: string, tool: LanguageTool, env: NodeJS.ProcessEnv = process.env): string =>
  (tool.download ? env[tool.env] : undefined) ?? join(packageDir(configDir, tool, env), tool.bin);

/** Installed, and the version pinned? A different version in the folder is
 *  not it — the pin is the point. A download is kept only once its hash
 *  matched, in a folder named by its version. */
export function installed(dir: string, tool: LanguageTool, env: NodeJS.ProcessEnv = process.env): boolean {
  if (tool.download) return existsSync(env[tool.env] ?? join(dir, tool.bin));
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

/** Fetch a release binary into `root`: the platform's asset, kept only when
 *  its sha256 is the pinned one. Null when it worked, or what went wrong. */
export async function fetchRelease(root: string, tool: LanguageTool, platform = `${process.platform}-${process.arch}`, get: typeof fetch = fetch): Promise<string | null> {
  const asset = tool.download?.assets[platform];
  if (!tool.download || !asset) return `no ${tool.name} build for ${platform}`;
  let body: Buffer;
  try {
    const response = await get(tool.download.url.replace("{asset}", asset.asset));
    if (!response.ok) return `download failed (HTTP ${response.status})`;
    body = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return `download failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (createHash("sha256").update(body).digest("hex") !== asset.sha256) return `${asset.asset} is not the pinned build (its sha256 differs)`;
  const bin = join(root, tool.bin);
  try {
    writeFileSync(`${bin}.part`, gunzipSync(body));
    chmodSync(`${bin}.part`, 0o755);
    renameSync(`${bin}.part`, bin);
  } catch (error) {
    return `could not unpack ${asset.asset}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

/** Run the install; resolves with null when it worked, or what went wrong. */
export function install(root: string, tool: LanguageTool): Promise<string | null> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  if (tool.download) return fetchRelease(root, tool);
  return new Promise((resolve) => {
    let stderr = "";
    const npm = spawn(process.platform === "win32" ? "npm.cmd" : "npm", [...installArgs(root, tool)], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    npm.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-2000)));
    npm.on("error", (error) => resolve(`npm did not start: ${error.message}`));
    npm.on("exit", (code) => resolve(code === 0 ? null : `npm install failed (exit ${code})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`));
  });
}

/** Remove every file or folder named in `names` from the tree at `root`,
 *  however deep — symlinked folders (linked dependencies) not entered. */
export function stripTree(root: string, names: ReadonlyArray<string>, depth = 0): void {
  if (depth > 12) return;
  let entries: Array<Dirent> = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (names.includes(entry.name)) rmSync(join(root, entry.name), { recursive: true, force: true });
    else if (entry.isDirectory() && !entry.isSymbolicLink()) stripTree(join(root, entry.name), names, depth + 1);
  }
}
