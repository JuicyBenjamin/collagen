import { Effect, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { RunAllowed } from "../../../lib/steering";
import type { Job, JobDone } from "../../Harness";

// A job of collagen's, run as a fresh `codex exec`: the person's model of
// choice (else their own Codex setting), the collagen server given on the
// command line with its tools pre-approved, and a read-only sandbox — it
// can look, never change anything on their machine.

export const runJob = (job: Job): Effect.Effect<JobDone, never, RunAllowed | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    yield* RunAllowed;
    const server = `mcp_servers.${job.server.name}`;
    const proc = yield* ChildProcess.make(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox", "read-only",
        ...(job.model ? ["-m", job.model] : []),
        "-c", `${server}.url="${job.server.url}"`,
        "-c", `${server}.default_tools_approval_mode="approve"`,
        job.prompt,
      ],
      { cwd: job.cwd, stdin: "ignore" },
    );
    const out = yield* proc.stdout.pipe(Stream.decodeText(), Stream.mkString);
    const exit = yield* proc.exitCode;
    const said = out.trim().split("\n").slice(-20).join("\n");
    return { ok: exit === 0, ...(said ? { said } : {}) };
  }).pipe(
    Effect.scoped,
    Effect.timeout("15 minutes"),
    Effect.catch((error) => Effect.logWarning(`job failed: ${String(error)}`).pipe(Effect.as({ ok: false, said: String(error) }))),
  );
