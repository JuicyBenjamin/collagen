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

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const child = spawn(process.execPath, ["--experimental-ffi", "--no-warnings=ExperimentalWarning", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
