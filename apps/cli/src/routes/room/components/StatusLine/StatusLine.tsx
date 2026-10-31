import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { theme } from "../../../../app/theme";
import { myNameAtom, roomAtom } from "../../../atoms";
import { aiStatusAtom, appUpdateAtom, jobsAtom, stateAtom } from "../../atoms";
import { jobsLine } from "../Jobs";
import { masterOf, STEERING_LABEL } from "../../../../lib/steering";
import { shownAi } from "../../../../lib/jobs";

/** "<name> (i) · uses <ai> (auth badge) · steering <level> (s) · update … (u)"
 *  — the one-line status. Who you are, the AI you use most (not chosen: how
 *  you work), and the general level in this room. What is going out is the
 *  outbox tab's count, not prose next to your agent. */
export function StatusLine() {
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "…");
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => null);
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const preferredAi = state ? shownAi(state) : null;
  const steering = masterOf(state ?? { steering: undefined }, "mine", roomId);
  const aiStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const bad = preferredAi !== null && aiStatus !== "ok" && aiStatus !== "unknown";
  const update = AsyncResult.getOrElse(useAtomValue(appUpdateAtom), () => ({ latest: null, installing: false, note: null }));
  const jobs = jobsLine(AsyncResult.getOrElse(useAtomValue(jobsAtom), () => []));

  return (
    // a row of air above: the word, what it is and which build are one block —
    // who you are and what runs for you is the room's header, not the brand
    <text truncate wrapMode="none" marginTop={1} flexShrink={0}>
      <span fg={theme.fg}>{myName}</span>
      <span fg={theme.dim}> (i) · uses </span>
      <span fg={preferredAi ? theme.fg : theme.dim}>{preferredAi ?? "no AI yet"}</span>
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthenticated"})</span> : null}
      {/* the general level in this room: how much may be done on its own;
          not chosen and the asking end dim, autonomy in the warn colour so it
          is never missed */}
      <span fg={theme.dim}> · steering </span>
      <span fg={steering === "ask" || steering === "unset" || steering === "never" ? theme.dim : theme.warn}>{STEERING_LABEL[steering]}</span>
      <span fg={theme.dim}> (s)</span>
      {jobs ? <span fg={theme.accent}> · {jobs} (outbox)</span> : null}
      {update.note ? (
        <span fg={update.installing ? theme.warn : theme.dim}> · {update.note}</span>
      ) : update.latest ? (
        <span fg={theme.warn}> · update {update.latest} available</span>
      ) : null}
      {update.latest && !update.installing ? <span fg={theme.dim}> (u)</span> : null}
    </text>
  );
}
