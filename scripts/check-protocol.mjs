#!/usr/bin/env node
// The protocol moves once per release. PROTOCOL_VERSION here may be what main
// (the released version) says, or one past it — never more: every change on
// the way to the next release shares that one bump, however many there are.
// Run by `pnpm lint` and in CI.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FILE = "packages/p2p/src/schema.ts";
const versionIn = (source) => {
  const found = /export const PROTOCOL_VERSION = "(\d+)";/.exec(source);
  return found ? Number(found[1]) : null;
};
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const here = versionIn(readFileSync(FILE, "utf8"));
if (here === null) {
  console.error(`check-protocol: no PROTOCOL_VERSION in ${FILE}`);
  process.exit(1);
}

let released;
try {
  // a shallow CI checkout has no main: fetch just its tip
  try {
    git("rev-parse", "--verify", "--quiet", "origin/main");
  } catch {
    git("fetch", "--depth=1", "origin", "main:refs/remotes/origin/main");
  }
  released = versionIn(git("show", `origin/main:${FILE}`));
} catch {
  console.warn("check-protocol: cannot read main's protocol here (no git, or no origin) — skipped");
  process.exit(0);
}
if (released === null) {
  console.warn("check-protocol: main has no PROTOCOL_VERSION — skipped");
  process.exit(0);
}

if (here === released || here === released + 1) process.exit(0);
console.error(
  here > released
    ? `check-protocol: PROTOCOL_VERSION is ${here}, main released ${released}. The next release is ${released + 1}: every change on the way shares that one bump — set it back to "${released + 1}".`
    : `check-protocol: PROTOCOL_VERSION is ${here}, behind main's ${released} — this branch is missing main.`,
);
process.exit(1);
