#!/usr/bin/env node
// release-please, run as a library so the "labelled" versioning strategy can
// be registered (the GitHub Action only knows the built-in ones). Does what
// the action does: create GitHub releases for a merged release commit, then
// create/update the release PR — and writes the same outputs for the workflow.
import { appendFileSync } from "node:fs";
import { GitHub, Manifest, registerVersioningStrategy } from "release-please";
import { labelled } from "./labelled-versioning.mjs";

registerVersioningStrategy("labelled", labelled);

const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
const token = process.env.GITHUB_TOKEN;
if (!owner || !repo || !token) {
  console.error("need GITHUB_REPOSITORY=owner/repo and GITHUB_TOKEN");
  process.exit(2);
}

const output = (key, value) => {
  const line = `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`;
  console.log(`output: ${line}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
};
const pathKey = (path, key) => (path === "." ? key : `${path}--${key}`);

const github = await GitHub.create({ owner, repo, token, defaultBranch: process.env.RELEASE_BRANCH ?? "main" });
const load = () => Manifest.fromManifest(github, github.repository.defaultBranch, "release-please-config.json", ".release-please-manifest.json");

// 1. a merged release PR → tags + GitHub releases
const releases = (await (await load()).createReleases()).filter(Boolean);
output("releases_created", releases.length > 0);
for (const r of releases) {
  output(pathKey(r.path ?? ".", "release_created"), true);
  output(pathKey(r.path ?? ".", "tag_name"), r.tagName);
  output(pathKey(r.path ?? ".", "version"), String(r.version ?? ""));
}

// 2. pending conventional commits → the release PR
const prs = (await (await load()).createPullRequests()).filter(Boolean);
output("prs_created", prs.length > 0);
if (prs.length > 0) output("pr", prs[0]);
