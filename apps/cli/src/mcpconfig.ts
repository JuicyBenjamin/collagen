import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Deterministic local port per profile, so the MCP URL is stable across runs
 *  (different profiles → different ports, so two local instances don't clash). */
export function portForProfile(profile: string): number {
  let h = 0;
  for (const c of profile) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 41000 + (h % 4000); // 41000–44999
}

/** MCP server name: `collagen` in prod (default profile), `collagen-<profile>`
 *  for dev so two local instances coexist in Claude's config. */
export function mcpServerName(profile: string): string {
  return profile === "default" ? "collagen" : `collagen-${profile}`;
}

/**
 * Register the cli's MCP server in Claude's USER config (`~/.claude.json`), so
 * it's available in every repo with no files written into the user's projects.
 * Idempotent: removes any existing entry first, then re-adds with the current url.
 */
export function registerMcpGlobally(name: string, url: string, onLog?: (s: string) => void): void {
  const add = () => {
    const c = spawn("claude", ["mcp", "add", "-s", "user", "-t", "http", name, url]);
    c.on("error", (e) => onLog?.(`mcp register failed (claude missing?): ${e.message}`));
    c.on("close", (code) => onLog?.(code === 0 ? `registered MCP ${name}` : `mcp add exited ${code}`));
  };
  const rm = spawn("claude", ["mcp", "remove", "-s", "user", name]);
  rm.on("error", add); // claude missing → add will surface it
  rm.on("close", add);
}

/**
 * Register the cli's MCP server in codex's user config (`~/.codex/config.toml`).
 * codex's CLI may be unavailable, so we edit the TOML directly — a targeted
 * block replace (not full parse/stringify) to preserve comments and other servers.
 */
export function registerCodexMcp(
  name: string,
  url: string,
  onLog?: (s: string) => void,
  configPath: string = join(homedir(), ".codex", "config.toml"),
): void {
  try {
    const file = configPath;
    if (!existsSync(file)) {
      onLog?.("codex config not found, skipping");
      return;
    }
    const block = `[mcp_servers.${name}]\nurl = "${url}"\n`;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\[mcp_servers\\.${escaped}\\][^[]*`, "m");
    let toml = readFileSync(file, "utf8");
    toml = re.test(toml) ? toml.replace(re, block) : toml.trimEnd() + "\n\n" + block;
    writeFileSync(file, toml);
    onLog?.(`registered codex MCP ${name}`);
  } catch (e) {
    onLog?.(`codex register failed: ${(e as Error).message}`);
  }
}
