import { execFile } from "node:child_process";
import { Effect } from "effect";

// git (and other commands) for the services that read a clone: never a
// failure — no git, no clone, no network all read as nothing.

/** Run a command, its stdout or null — never a failure: no git, no clone, no
 *  network all degrade the page, they do not break it. */
export const run = (cmd: string, args: ReadonlyArray<string>, cwd: string | undefined, timeoutMs: number): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    const child = execFile(cmd, [...args], { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err, stdout) =>
      resume(Effect.succeed(err ? null : stdout)),
    );
    return Effect.sync(() => child.kill());
  });

/** The first of `refs` the repo knows as a commit. */
export const firstRef = (cwd: string, refs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const ref of refs) {
      const ok = yield* run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd, 5_000);
      if (ok !== null && ok.trim().length > 0) return ref;
    }
    return null;
  });
