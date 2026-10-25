import { join } from "node:path";
import { Effect, FileSystem } from "effect";

/** Registers in Codex's user config (`<codex home>/config.toml`). codex's CLI may
 *  be unavailable, so edit the TOML directly — a targeted block replace (not
 *  full parse/stringify) to preserve comments and other servers. */
export const register = Effect.fn("Codex.register")(
  function* (name: string, url: string, home: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const file = join(home, "config.toml");
    const exists = yield* fileSystem.exists(file);
    if (!exists) {
      yield* Effect.log("codex config not found, skipping");
      return;
    }
    // approval_mode: codex ≥0.14x requires per-tool approval for MCP calls;
    // "approve" pre-trusts our tools so headless `codex exec` can use them.
    const block = `[mcp_servers.${name}]\nurl = "${url}"\ndefault_tools_approval_mode = "approve"\n`;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\[mcp_servers\\.${escaped}\\][^[]*`, "m");
    const write = Effect.gen(function* () {
      const toml = yield* fileSystem.readFileString(file);
      const next = pattern.test(toml) ? toml.replace(pattern, block) : toml.trimEnd() + "\n\n" + block;
      yield* fileSystem.writeFileString(file, next);
    });
    // Two instances starting together (multi-profile dev) race on this file:
    // a concurrent read-modify-write can carry our stale block back over the
    // fresh one. Verify our block landed; rewrite if it got clobbered.
    for (let attempt = 0; attempt < 5; attempt++) {
      yield* write;
      yield* Effect.sleep(`${50 + attempt * 100} millis`);
      const after = yield* fileSystem.readFileString(file);
      if (after.includes(block)) break;
      yield* Effect.logWarning(`codex config write clobbered (attempt ${attempt + 1}), retrying`);
    }
    yield* Effect.log(`registered codex MCP ${name}`);
  },
  Effect.catch((error) => Effect.logWarning(`codex register failed: ${String(error)}`)),
);
