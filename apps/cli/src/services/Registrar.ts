import { Effect } from "effect";
import { mcpServerName } from "./mcpAddress";
import { CliArgs } from "./CliArgs";
import { Harnesses, homesOf } from "./Harness";
import { McpInfo } from "./McpInfo";

// Registers collagen's MCP server with every harness, in its own config
// (Harness.register), so it is there in every repo with no files written into
// the person's projects.

/** Waits for the MCP server URL, then registers it with every harness. */
export const registerAll = Effect.gen(function* () {
  // a test harness runs many instances against throwaway homes: nothing to
  // register, and no agent CLI to run for it
  if (process.env.COLLAGEN_REGISTER === "0") return yield* Effect.log("COLLAGEN_REGISTER=0: not registering the MCP server with any agent");
  const { profile } = yield* CliArgs;
  const mcpInfo = yield* McpInfo;
  const url = yield* mcpInfo.awaitUrl;
  const name = mcpServerName(profile);
  const harnesses = yield* Harnesses;
  const homes = homesOf(harnesses);
  yield* Effect.all(
    harnesses.map((harness) => harness.register(name, url, homes[harness.id] ?? "")),
    { concurrency: "unbounded" },
  );
}).pipe(Effect.withSpan("Registrar.registerAll"));
