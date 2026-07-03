import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Command, FileSystem } from "@effect/platform";
import { mcpServerName } from "../util";
import { CliArgs } from "./CliArgs";
import { McpInfo } from "./McpInfo";

/** Registers the cli's MCP server in Claude's USER config (`~/.claude.json`),
 *  so it's available in every repo with no files written into user projects.
 *  Idempotent: remove any existing entry first, then re-add with the current url. */
const registerClaude = (name: string, url: string) =>
  Effect.gen(function* () {
    yield* Command.exitCode(Command.make("claude", "mcp", "remove", "-s", "user", name)).pipe(
      Effect.ignore, // may not exist yet
    );
    const code = yield* Command.exitCode(
      Command.make("claude", "mcp", "add", "-s", "user", "-t", "http", name, url),
    );
    yield* code === 0
      ? Effect.log(`registered claude MCP ${name}`)
      : Effect.logWarning(`claude mcp add exited ${code}`);
  }).pipe(Effect.catchAll((e) => Effect.logWarning(`claude register failed: ${String(e)}`)));

/** Registers in codex's user config (`~/.codex/config.toml`). codex's CLI may
 *  be unavailable, so edit the TOML directly — a targeted block replace (not
 *  full parse/stringify) to preserve comments and other servers. */
const registerCodex = (name: string, url: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = join(homedir(), ".codex", "config.toml");
    const exists = yield* fs.exists(file);
    if (!exists) {
      yield* Effect.log("codex config not found, skipping");
      return;
    }
    // approval_mode: codex ≥0.14x requires per-tool approval for MCP calls;
    // "approve" pre-trusts our tools so headless `codex exec` can use them.
    const block = `[mcp_servers.${name}]\nurl = "${url}"\ndefault_tools_approval_mode = "approve"\n`;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\[mcp_servers\\.${escaped}\\][^[]*`, "m");
    const toml = yield* fs.readFileString(file);
    const next = re.test(toml) ? toml.replace(re, block) : toml.trimEnd() + "\n\n" + block;
    yield* fs.writeFileString(file, next);
    yield* Effect.log(`registered codex MCP ${name}`);
  }).pipe(Effect.catchAll((e) => Effect.logWarning(`codex register failed: ${String(e)}`)));

/** Waits for the MCP server URL, then registers it with both supported AIs. */
export const registerAll = Effect.gen(function* () {
  const { profile } = yield* CliArgs;
  const mcpInfo = yield* McpInfo;
  const url = yield* mcpInfo.awaitUrl;
  const name = mcpServerName(profile);
  yield* Effect.all([registerClaude(name, url), registerCodex(name, url)], { concurrency: 2 });
});
