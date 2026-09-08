#!/usr/bin/env node
// The TUI's renderer (OpenTUI) loads a native library through Node's FFI,
// which needs a runtime flag that a bin script can't carry itself — so this
// shim re-runs Node with it. Everything else (arguments, stdio, exit code,
// signals) passes straight through.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 26 || (major === 26 && minor < 4)) {
  console.error(`collagen needs Node 26.4 or newer (this is ${process.versions.node}).`);
  process.exit(1);
}

// `collagen --headless …` runs the same app without a terminal (servers, a
// spare machine): no renderer, so no FFI flag needed. One bin for both, so
// `npx @collagen/cli` knows what to run.
const args = process.argv.slice(2);
const headless = args.includes("--headless");
const entry = fileURLToPath(new URL(headless ? "../dist/headless.js" : "../dist/index.js", import.meta.url));
const nodeFlags = headless ? [] : ["--experimental-ffi", "--no-warnings=ExperimentalWarning"];
const child = spawn(process.execPath, [...nodeFlags, entry, ...args.filter((a) => a !== "--headless")], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
