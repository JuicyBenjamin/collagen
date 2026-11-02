import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { fileURLToPath } from "node:url";

// Collagen's pages, built once into dist/ and served by the collagen instance
// at their rooms' addresses (apps/cli/src/services/ReviewView). Laid out as
// Solid's own: the build under /_build/assets/, hashed, so the instance can
// cache it for good, and the server functions at /_server.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    solid({
      // "use server" functions (src/api.ts): compiled to calls on the page,
      // and to a handler the collagen instance mounts at /_server
      serverFunctions: { endpoint: "/_server" },
    }),
  ],
  // ~/ is src/ (tsconfig.json says the same)
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  base: "/",
  // the server bundle (vite build --ssr src/server/entry.ts) carries Solid
  // in it; effect stays out, so it runs on the instance's own copy
  ssr: { noExternal: true, external: ["effect"] },
  build: {
    outDir: "dist",
    // dist/server is the server bundle's, built beside it: `build` clears dist first
    emptyOutDir: false,
    assetsDir: "_build/assets",
    target: "es2022",
    // the server bundle is one file: collagen loads it again when it is
    // rebuilt, and a chunk importing back from entry.js would load a second
    // copy of it — one whose backend was never provided
    ...(isSsrBuild ? { rolldownOptions: { output: { codeSplitting: false } } } : {}),
  },
}));
