import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

// One publishable package: the cli's two entries with @collagen/p2p bundled
// in (it is a workspace package, never published on its own). Everything
// else stays a dependency — the p2p stack's native addons ship prebuilds and
// must be installed, not bundled.
export default defineConfig({
  entry: { index: "src/index.tsx", headless: "src/headless.ts" },
  format: "esm",
  platform: "node",
  target: "esnext",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: ["@collagen/p2p"],
  define: { __COLLAGEN_VERSION__: JSON.stringify(pkg.version) },
  onSuccess: async () => {
    // the mock agent is a plain script spawned by path, not an import
    mkdirSync("dist", { recursive: true });
    copyFileSync("src/dev/mock-agent.mjs", "dist/mock-agent.mjs");
  },
});
