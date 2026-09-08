import { describe, expect, it } from "vitest";
import { installPlan } from "./Updates";

describe("installPlan", () => {
  const latest = "0.2.0-alpha";
  it("a source run updates with git", () => {
    expect(installPlan("/repo/apps/cli/src/services/Updates.ts", "dev", latest)).toEqual({ kind: "source" });
  });
  it("npx has nothing to install", () => {
    expect(installPlan("/Users/me/.npm/_npx/abc123/node_modules/@collagen/cli/dist/index.js", "0.1.1-alpha", latest)).toEqual({ kind: "npx" });
  });
  it("npm global installs reinstall with npm", () => {
    const plan = installPlan("/usr/local/lib/node_modules/@collagen/cli/dist/index.js", "0.1.1-alpha", latest);
    expect(plan).toEqual({ kind: "global", cmd: "npm", args: ["install", "-g", "@collagen/cli@0.2.0-alpha"] });
    expect(installPlan("C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@collagen\\cli\\dist\\index.js", "0.1.1-alpha", latest).kind).toBe("global");
  });
  it("pnpm global installs reinstall with pnpm", () => {
    const plan = installPlan("/Users/me/Library/pnpm/global/5/.pnpm/@collagen+cli@0.1.1-alpha/node_modules/@collagen/cli/dist/index.js", "0.1.1-alpha", latest);
    expect(plan).toEqual({ kind: "global", cmd: "pnpm", args: ["add", "-g", "@collagen/cli@0.2.0-alpha"] });
  });
  it("a project-local install gets an instruction", () => {
    expect(installPlan("/work/app/node_modules/@collagen/cli/dist/index.js", "0.1.1-alpha", latest).kind).toBe("local");
  });
});
