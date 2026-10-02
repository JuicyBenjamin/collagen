import { defineConfig } from "vitest/config";

// The tests cover the pure modules (highlighting); no DOM, so no Solid plugin
// and none of the jsdom it would ask for.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
