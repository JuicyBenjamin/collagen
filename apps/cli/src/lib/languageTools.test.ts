import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolIds, toolOf } from "@collagen/review-web/data";
import { composerVendorDir, installArgs, installed, packageDir, toolRoot, TOOLS } from "./languageTools";

const typescriptTool = TOOLS.typescript;

describe("the pinned language tools", () => {
  it("every language the page knows has a tool, and every file finds its own", () => {
    for (const id of toolIds()) expect(TOOLS[id].id).toBe(id);
    expect(toolOf("src/a.ts")).toBe("typescript");
    expect(toolOf("src/A.TSX")).toBe("typescript");
    expect(toolOf("src/a.css")).toBeNull();
    expect(toolOf("app/Http/Controller.php")).toBe("php");
    expect(toolOf("views/page.phtml")).toBe("php");
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
    expect(TOOLS.php.deps.dirFrom).toBe(composerVendorDir);
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
});
