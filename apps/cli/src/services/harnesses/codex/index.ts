import { join } from "node:path";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { DeliverAllowed } from "../../../lib/steering";
import { sessionFiles } from "../../../lib/tokenCost";
import { walk } from "../../../lib/transcripts";
import type { Harness } from "../../Harness";
import { codexCall } from "./call";
import { runJob } from "./job";
import { register } from "./register";
import { keepsWhole, readLine } from "./transcript";
import { readUsage } from "./usage";

// Codex, in the terminal or the Codex app: how collagen tells its calls and
// threads (./call), registers with it (./register), and reads its session
// logs (./transcript, ./usage). A thread is reached by its id alone: `codex
// queue` puts a line into it, which shows in the open window and is answered
// at its next turn. Nothing outside this folder knows any of it.

export const codex: Harness = {
  id: "codex",
  name: "Codex",
  matches: (clientName) => /^codex/i.test(clientName),
  home: (env, home) => env.CODEX_HOME ?? join(home, ".codex"),
  readCall: (meta) =>
    Effect.sync(() => {
      const call = codexCall(meta);
      return call ? { turn: call.turn, ...(call.thread ? { conversation: call.thread } : {}) } : null;
    }),
  reachOf: Effect.succeed(undefined),
  wakesBy: "queued into this Codex thread",
  // Codex runs your own model setting unless you choose one per job
  defaultModels: {},
  runJob,
  wake: (conversation, _reach, line) =>
    Effect.gen(function* () {
      yield* DeliverAllowed;
      const proc = yield* ChildProcess.make("codex", ["queue", "--thread", conversation, "--message", line], { stdin: "ignore" });
      const exit = yield* proc.exitCode;
      yield* Effect.log(`queued into codex thread ${conversation.slice(0, 8)}… (exit ${exit})`);
      return { reached: exit === 0 };
    }).pipe(
      Effect.scoped,
      Effect.catch((error) => Effect.logWarning(`codex queue failed: ${String(error)}`).pipe(Effect.as({ reached: false }))),
    ),
  signIn: { cmd: "codex", args: ["login", "status"], loggedIn: (out, exitCode) => exitCode === 0 && !/not logged in/i.test(out) },
  watchRecipe: () =>
    [
      "You are on Codex. Collagen wakes this thread itself when something comes for it: watch-ticket (a ticket) or adopt-thread (a thread) says it should hear it, and the line is queued into this thread (codex queue), as your user's delivery steering allows — it appears at your next turn while your user keeps chatting.",
      "When one appears: tell the user the headline it carries and wait; read the thread only when they ask; never answer it on your own. For threads you do not listen for, check pending-threads when convenient.",
    ].join("\n"),
  // `<codex>/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl` — the layout is
  // mid-migration, so any `.jsonl` under sessions whose name carries the id counts
  register,
  transcriptOf: (conversation, home) => walk(join(home, "sessions")).find((file) => file.endsWith(".jsonl") && file.includes(conversation)) ?? null,
  readLine,
  keepsWhole,
  usage: {
    sessions: (home, since) => sessionFiles(join(home, "sessions"), since, 5),
    read: readUsage,
  },
};
