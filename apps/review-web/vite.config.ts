import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// The review page, built once into dist/ and served by the collagen instance
// at /review/<ticketId> (apps/cli/src/services/ReviewView). Assets live under
// /review/assets/, hashed, so the instance can cache them for good.
export default defineConfig({
  plugins: [solid()],
  base: "/review/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2022",
  },
});
