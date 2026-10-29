import { join } from "node:path";
import { Clock, Effect } from "effect";
import { sessionFiles } from "../../../lib/tokenCost";
import { walk } from "../../../lib/transcripts";
import type { Harness } from "../../Harness";
import { claudeCallOf, objectOf, text } from "./call";
import { runJob } from "./job";
import { callerSocket, courier } from "./reach";
import { register } from "./register";
import { readLine } from "./transcript";
import { readUsage } from "./usage";

// Claude Code, in the terminal or the desktop app: how collagen tells its
// calls and conversations (./call), reaches and wakes a session (./reach),
// runs a job (./job), registers with it (./register), and reads its session
// logs (./transcript, ./usage). Nothing outside this folder knows any of it.

/** How often, and how far apart, a call is looked for in the session log. */
const LOOKS = 12;
const BETWEEN_LOOKS = "250 millis";

export const claudeCode: Harness = {
  id: "claude-code",
  name: "Claude Code",
  matches: (clientName) => /^claude[-_ ]?code/i.test(clientName),
  home: (env, home) => env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
  readCall: (meta, home) =>
    Effect.gen(function* () {
      const id = text(objectOf(meta)["claudecode/toolUseId"]);
      if (!id) return null;
      // Claude Code flushes its session log in batches, so the entry holding
      // this call may land a moment after the call itself: look again, briefly
      let call = null;
      for (let attempt = 0; attempt < LOOKS && call === null; attempt++) {
        if (attempt > 0) yield* Effect.sleep(BETWEEN_LOOKS);
        const now = yield* Clock.currentTimeMillis;
        call = yield* Effect.promise(() => claudeCallOf(id, now, home).catch(() => null));
      }
      return { turn: call?.turn ?? null, ...(call?.session ? { conversation: call.session } : {}) };
    }),
  reachOf: callerSocket,
  wakesBy: "a courier tells this conversation in one line",
  wake: courier,
  defaultModels: { wake: "haiku", research: "sonnet" },
  runJob,
  signIn: {
    cmd: "claude",
    args: ["auth", "status"],
    loggedIn: (out) => {
      try {
        return (JSON.parse(out) as { loggedIn?: boolean }).loggedIn === true;
      } catch {
        return false;
      }
    },
  },
  watchRecipe: (origin) =>
    [
      "You are on Claude Code. Collagen wakes this conversation itself when something comes for it: watch-ticket (a ticket) or adopt-thread (a thread) says it should hear it, and a courier tells it in one line, as your user's delivery steering allows. Nothing to arm.",
      "To also follow the whole room live while your user keeps chatting, arm a background monitor (Monitor tool, or a background bash task); each output line is one new-message event:",
      "",
      "while true; do",
      `  out=$(curl -s -m 70 "${origin}/inbox/wait?seconds=60" || true)`,
      '  [ -n "$out" ] && printf \'%s\\n\' "$out"',
      "  sleep 1",
      "done",
      "",
      "On each event: tell the user the headline in the event line (who, project, intent) and wait. Read the thread with get-messages only when they ask what it says; never answer or act on it yourself.",
    ].join("\n"),
  register,
  transcriptOf: (conversation, home) => walk(join(home, "projects"), 2).find((file) => file.endsWith(`/${conversation}.jsonl`)) ?? null,
  readLine,
  keepsWhole: () => false,
  usage: {
    // sub-agents' sessions sit beside their parent's
    sessions: (home, since) => sessionFiles(join(home, "projects"), since, 4),
    read: readUsage,
  },
};
