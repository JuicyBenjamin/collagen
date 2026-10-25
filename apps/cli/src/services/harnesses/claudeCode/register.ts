import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** Registers the cli's MCP server in Claude's USER config (`~/.claude.json`),
 *  so it's available in every repo with no files written into user projects.
 *  Idempotent: remove any existing entry first, then re-add with the current url. */
export const register = Effect.fn("ClaudeCode.register")(
  function* (name: string, url: string, _home: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    yield* spawner.exitCode(ChildProcess.make("claude", ["mcp", "remove", "-s", "user", name])).pipe(
      Effect.ignore, // may not exist yet
    );
    const code = yield* spawner.exitCode(
      ChildProcess.make("claude", ["mcp", "add", "-s", "user", "-t", "http", name, url]),
    );
    yield* code === 0
      ? Effect.log(`registered claude MCP ${name}`)
      : Effect.logWarning(`claude mcp add exited ${code}`);
  },
  Effect.catch((error) => Effect.logWarning(`claude register failed: ${String(error)}`)),
);
