import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installArgs, installed, packageDir, toolRoot, TYPESCRIPT_VERSION } from "./typescriptTool";

describe("the pinned TypeScript", () => {
  it("lives under collagen's own folder, by version", () => {
    expect(toolRoot("/cfg")).toBe(`/cfg/tools/typescript-${TYPESCRIPT_VERSION}`);
    expect(packageDir("/cfg", {})).toBe(`/cfg/tools/typescript-${TYPESCRIPT_VERSION}/node_modules/typescript`);
    expect(packageDir("/cfg", { COLLAGEN_TYPESCRIPT: "/elsewhere/typescript" })).toBe("/elsewhere/typescript");
  });

  it("installs exactly the pinned version, without running install scripts", () => {
    const args = installArgs("/r");
    expect(args).toContain(`typescript@${TYPESCRIPT_VERSION}`);
    expect(args).toContain("--ignore-scripts");
    expect(args.slice(0, 3)).toEqual(["install", "--prefix", "/r"]);
  });

  it("is installed only when the pinned version is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-tool-"));
    expect(installed(dir, {})).toBe(false);
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "tsc"), "");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "6.0.0" }));
    expect(installed(dir, {})).toBe(false);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: TYPESCRIPT_VERSION }));
    expect(installed(dir, {})).toBe(true);
  });
});
