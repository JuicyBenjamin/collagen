import { Effect, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { RunAllowed } from "../../../lib/steering";
import type { Job, JobDone } from "../../Harness";
import { courierSpent } from "./reach";

// A job of collagen's, run as a fresh headless Claude Code session: the
// person's model of choice, the collagen tools a job needs and read-only
// looking (the project's files, the web) — nothing of the person's setup
// loaded, nothing it could change on their machine.

/** The collagen tools a job may call, on the server `name`. */
const COLLAGEN_TOOLS = ["get-ticket", "get-tickets", "review-context", "post-review"];
/** What a job may use besides: reading the project and the web. */
const LOOKING = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"];

export const runJob = (job: Job): Effect.Effect<JobDone, never, RunAllowed | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    yield* RunAllowed;
    const allowed = [...COLLAGEN_TOOLS.map((tool) => `mcp__${job.server.name}__${tool}`), ...LOOKING];
    const proc = yield* ChildProcess.make(
      "claude",
      [
        "-p", job.prompt,
        ...(job.model ? ["--model", job.model] : []),
        "--mcp-config", JSON.stringify({ mcpServers: { [job.server.name]: { type: "http", url: job.server.url } } }),
        "--strict-mcp-config",
        "--tools", LOOKING.join(","),
        "--allowedTools", allowed.join(","),
        "--setting-sources", "",
        "--disable-slash-commands",
        "--max-turns", "40",
        "--output-format", "json",
      ],
      { cwd: job.cwd, stdin: "ignore" },
    );
    const out = yield* proc.stdout.pipe(Stream.decodeText(), Stream.mkString);
    const exit = yield* proc.exitCode;
    const spent = courierSpent(out);
    let said: string | undefined;
    try {
      const result = JSON.parse(out.trim().split("\n").at(-1) ?? "") as { result?: unknown };
      said = typeof result.result === "string" ? result.result : undefined;
    } catch {
      said = undefined;
    }
    return { ok: exit === 0, ...(said ? { said } : {}), ...(spent ? { spent } : {}) };
  }).pipe(
    Effect.scoped,
    Effect.timeout("15 minutes"),
    Effect.catch((error) => Effect.logWarning(`job failed: ${String(error)}`).pipe(Effect.as({ ok: false, said: String(error) }))),
  );
