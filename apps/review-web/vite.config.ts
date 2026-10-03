import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// The review page, built once into dist/ and served by the collagen instance
// at /review/<ticketId> (apps/cli/src/services/ReviewView). Assets live under
// /review/assets/, hashed, so the instance can cache them for good.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    solid({
      // "use server" functions (src/api.ts): compiled to calls on the page,
      // and to a handler the collagen instance mounts at /review/_server (the base, then this)
      serverFunctions: { endpoint: "/_server" },
    }),
  ],
  base: "/review/",
  // the server bundle (vite build --ssr src/server/entry.ts) carries Solid
  // in it; effect stays out, so it runs on the instance's own copy
  ssr: { noExternal: true, external: ["effect"] },
  build: {
    outDir: "dist",
    // dist/server is the server bundle's, built beside it: `build` clears dist first
    emptyOutDir: false,
    assetsDir: "assets",
    target: "es2022",
    // the server bundle is one file: collagen loads it again when it is
    // rebuilt, and a chunk importing back from entry.js would load a second
    // copy of it — one whose backend was never provided
    ...(isSsrBuild ? { rolldownOptions: { output: { codeSplitting: false } } } : {}),
  },
}));
