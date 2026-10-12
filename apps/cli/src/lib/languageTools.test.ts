import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toolIds, toolOf } from "@collagen/review-web/data";
import { composerVendorDir, fetchRelease, installArgs, installed, packageDir, rustPlace, serverPath, stripTree, toolRoot, TOOLS, type LanguageTool } from "./languageTools";

const typescriptTool = TOOLS.typescript;

describe("the pinned language tools", () => {
  it("every language the page knows has a tool, and every file finds its own", () => {
    for (const id of toolIds()) expect(TOOLS[id].id).toBe(id);
    expect(toolOf("src/a.ts")).toBe("typescript");
    expect(toolOf("src/A.TSX")).toBe("typescript");
    expect(toolOf("src/a.css")).toBeNull();
    expect(toolOf("app/Http/Controller.php")).toBe("php");
    expect(toolOf("views/page.phtml")).toBe("php");
    expect(toolOf("src/main.rs")).toBe("rust");
  });

  it("PHP's server is Intelephense: its own licence said, vendor/ beside composer.json, telemetry off", () => {
    const php = TOOLS.php;
    expect(php.licence?.url).toMatch(/^https:\/\/intelephense\.com\//);
    expect(php.deps).toMatchObject({ marker: "composer.json", dir: "vendor" });
    expect(php.settings).toEqual({ telemetry: { enabled: false } });
    expect(php.initializationOptions?.("/s")).toMatchObject({ storagePath: "/s", telemetry: { enabled: false } });
    expect(packageDir("/cfg", php, { COLLAGEN_INTELEPHENSE: "/x/intelephense" })).toBe("/x/intelephense");
    expect(php.readyWhen?.("$/progress", { token: "t", value: { kind: "end" } })).toBe(true);
    expect(php.readyWhen?.("$/progress", { token: "t", value: { kind: "report" } })).toBe(false);
  });

  it("a project that moves vendor/ says so in composer.json, and that is where its packages are", () => {
    expect(composerVendorDir(JSON.stringify({ config: { "vendor-dir": "lib/deps/" } }))).toBe("lib/deps");
    expect(composerVendorDir(JSON.stringify({ require: {} }))).toBeNull();
    expect(composerVendorDir("not json")).toBeNull();
    expect(TOOLS.php.deps?.dirFrom).toBe(composerVendorDir);
  });

  it("lives under collagen's own folder, by package and version", () => {
    expect(toolRoot("/cfg", typescriptTool)).toBe(`/cfg/tools/typescript-${typescriptTool.version}`);
    expect(packageDir("/cfg", typescriptTool, {})).toBe(`/cfg/tools/typescript-${typescriptTool.version}/node_modules/typescript`);
    expect(packageDir("/cfg", typescriptTool, { COLLAGEN_TYPESCRIPT: "/elsewhere/typescript" })).toBe("/elsewhere/typescript");
  });

  it("installs exactly the pinned version, without running install scripts", () => {
    const args = installArgs("/r", typescriptTool);
    expect(args).toContain(`typescript@${typescriptTool.version}`);
    expect(args).toContain("--ignore-scripts");
    expect(args.slice(0, 3)).toEqual(["install", "--prefix", "/r"]);
  });

  it("is installed only when the pinned version is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "lang-tool-"));
    expect(installed(dir, typescriptTool, {})).toBe(false);
    mkdirSync(dirname(join(dir, typescriptTool.bin)), { recursive: true });
    writeFileSync(join(dir, typescriptTool.bin), "");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "6.0.0" }));
    expect(installed(dir, typescriptTool, {})).toBe(false);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: typescriptTool.version }));
    expect(installed(dir, typescriptTool, {})).toBe(true);
  });

  it("Rust's server never runs the branch's code, and fetches nothing", () => {
    const rust = TOOLS.rust;
    expect(rust.initializationOptions?.("/s")).toMatchObject({
      cargo: { buildScripts: { enable: false }, extraEnv: { CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: "/s/target" } },
      procMacro: { enable: false },
      checkOnSave: false,
      hover: { memoryLayout: { enable: false } },
    });
    expect(rust.spawnEnv?.("/s")).toEqual({ CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: "/s/target" });
    expect(rust.strip).toEqual(expect.arrayContaining([".cargo", "rust-toolchain", "rust-toolchain.toml", "rust-analyzer.toml"]));
    for (const asset of Object.values(rust.download!.assets)) expect(asset!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rust.download!.url).toContain(`/download/${rust.version}/`);
    expect(rust.readyWhen?.("experimental/serverStatus", { health: "ok", quiescent: true })).toBe(true);
    expect(rust.readyWhen?.("experimental/serverStatus", { health: "ok", quiescent: false })).toBe(false);
  });

  it("a Rust declaration outside the branch is std's or a crate's, by where it sits", () => {
    expect(rustPlace("/h/.rustup/toolchains/stable-aarch64-apple-darwin/lib/rustlib/src/rust/library/core/src/option.rs")).toEqual({ where: "builtin", file: "core/src/option.rs" });
    expect(rustPlace("/h/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.200/src/de/mod.rs")).toEqual({ where: "package", file: "serde-1.0.200/src/de/mod.rs" });
    expect(rustPlace("/h/.cargo/git/checkouts/tokio-abc123/4f2e1a0/tokio/src/lib.rs")).toEqual({ where: "package", file: "tokio/src/lib.rs" });
    expect(rustPlace("/tmp/collagen-review/1/x/src/lib.rs")).toBeNull();
  });

  it("a release binary is kept only when its sha256 is the pinned one", async () => {
    const binary = Buffer.from("#!/bin/sh\necho hi\n");
    const zipped = gzipSync(binary);
    const tool: LanguageTool = {
      ...TOOLS.rust,
      download: { url: "https://example.test/{asset}", assets: { "darwin-arm64": { asset: "ra.gz", sha256: createHash("sha256").update(zipped).digest("hex") } } },
    };
    const asked: Array<string> = [];
    const serve = (body: Buffer) => (async (url: string | URL | Request) => (asked.push(String(url)), new Response(new Uint8Array(body)))) as typeof fetch;
    const root = mkdtempSync(join(tmpdir(), "lang-tool-"));
    expect(await fetchRelease(root, tool, "win32-x64", serve(zipped))).toBe("no rust-analyzer build for win32-x64");
    expect(await fetchRelease(root, tool, "darwin-arm64", serve(gzipSync(Buffer.from("not it"))))).toMatch(/sha256 differs/);
    expect(existsSync(join(root, tool.bin))).toBe(false);
    expect(installed(root, tool, {})).toBe(false);
    expect(await fetchRelease(root, tool, "darwin-arm64", serve(zipped))).toBeNull();
    expect(asked.at(-1)).toBe("https://example.test/ra.gz");
    expect(readFileSync(join(root, tool.bin))).toEqual(binary);
    expect(statSync(join(root, tool.bin)).mode & 0o111).not.toBe(0);
    expect(installed(root, tool, {})).toBe(true);
  });

  it("a download is run as itself: its pinned folder, or the binary its env names", () => {
    const rust = TOOLS.rust;
    expect(serverPath("/cfg", rust, {})).toBe(`/cfg/tools/rust-analyzer-${rust.version}/rust-analyzer`);
    expect(serverPath("/cfg", rust, { COLLAGEN_RUST_ANALYZER: "/bin/ra" })).toBe("/bin/ra");
    expect(serverPath("/cfg", typescriptTool, {})).toBe(`/cfg/tools/typescript-${typescriptTool.version}/node_modules/typescript/bin/tsc`);
  });

  it("files a toolchain would obey are gone from the tree, however deep", () => {
    const root = mkdtempSync(join(tmpdir(), "lang-tree-"));
    for (const file of [".cargo/config.toml", "rust-toolchain.toml", "crates/a/.cargo/config", "crates/a/rust-toolchain", "crates/a/src/lib.rs"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    stripTree(root, TOOLS.rust.strip!);
    expect([".cargo", "rust-toolchain.toml", "crates/a/.cargo", "crates/a/rust-toolchain"].filter((file) => existsSync(join(root, file)))).toEqual([]);
    expect(existsSync(join(root, "crates/a/src/lib.rs"))).toBe(true);
  });
});
