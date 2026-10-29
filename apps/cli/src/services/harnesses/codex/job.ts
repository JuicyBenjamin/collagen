import { Effect, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { RunAllowed } from "../../../lib/steering";
import type { Job, JobDone, Spent } from "../../Harness";

// A job of collagen's, run as a fresh `codex exec`: the person's model of
// choice (else their own Codex setting), the collagen server given on the
// command line with its tools pre-approved, and a read-only sandbox — it
// can look, never change anything on their machine. Its events come as
// JSONL: what it last said, how the turn ended, and what it spent.

/** What a `codex exec --json` run said last, whether its turn failed, and
 *  what its turns spent. */
export const readExec = (out: string, model?: string): { readonly said?: string; readonly failed?: string; readonly spent?: Spent } => {
  let said: string | undefined;
  let failed: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let turns = 0;
  for (const line of out.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: { type?: string; item?: { type?: string; text?: string }; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string }; message?: string };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) said = event.item.text;
    if (event.type === "turn.completed" && event.usage) {
      turns++;
      inputTokens += event.usage.input_tokens ?? 0;
      outputTokens += event.usage.output_tokens ?? 0;
    }
    if (event.type === "turn.failed") failed = event.error?.message ?? "its turn failed";
  }
  return {
    ...(said ? { said } : {}),
    ...(failed ? { failed } : {}),
    ...(turns > 0 ? { spent: { ...(model ? { model } : {}), inputTokens, outputTokens } } : {}),
  };
};

export const runJob = (job: Job): Effect.Effect<JobDone, never, RunAllowed | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    yield* RunAllowed;
    const server = `mcp_servers.${job.server.name}`;
    const proc = yield* ChildProcess.make(
      "codex",
      [
        "exec",
        "--json",
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
    const read = readExec(out, job.model);
    const said = read.failed ?? read.said;
    return { ok: exit === 0 && !read.failed, ...(said ? { said } : {}), ...(read.spent ? { spent: read.spent } : {}) };
  }).pipe(
    Effect.scoped,
    Effect.timeout("15 minutes"),
    Effect.catch((error) => Effect.logWarning(`job failed: ${String(error)}`).pipe(Effect.as({ ok: false, said: String(error) }))),
  );
