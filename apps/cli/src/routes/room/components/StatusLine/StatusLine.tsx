import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { theme } from "../../../../app/theme";
import { myNameAtom } from "../../../atoms";
import { aiStatusAtom, appUpdateAtom, stateAtom } from "../../atoms";
import { STEERING_LABEL, steeringOf } from "../../../../lib/steering";

/** "<name> · ai <choice> (auth badge) · steering <level> (g) · update … (u)" — the one-line status.
 *  Who you are and what runs for you. What is going out is the outbox tab's
 *  count, not prose next to your agent. */
export function StatusLine() {
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "…");
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => ({ preferredAi: null }) as { preferredAi: string | null; steering?: "ask" | "act" | "auto" });
  const ai = state.preferredAi;
  const steering = steeringOf(state);
  const aiStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const bad = ai !== null && aiStatus !== "ok" && aiStatus !== "unknown";
  const update = AsyncResult.getOrElse(useAtomValue(appUpdateAtom), () => ({ latest: null, installing: false, note: null }));

  return (
    // a row of air above: the word, what it is and which build are one block —
    // who you are and what runs for you is the room's header, not the brand
    <text truncate wrapMode="none" marginTop={1} flexShrink={0}>
      <span fg={theme.fg}>{myName}</span>
      <span fg={theme.dim}> · ai </span>
      <span fg={ai ? theme.warn : theme.dim}>{ai ?? "not set"}</span>
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthenticated"})</span> : null}
      {/* how much it may do on its own — beside the agent it steers; the
          asking end dim, autonomy in the warn colour so it is never missed */}
      <span fg={theme.dim}> · steering </span>
      <span fg={steering === "ask" ? theme.dim : theme.warn}>{STEERING_LABEL[steering]}</span>
      <span fg={theme.dim}> (g)</span>
      {update.note ? (
        <span fg={update.installing ? theme.warn : theme.dim}> · {update.note}</span>
      ) : update.latest ? (
        <span fg={theme.warn}> · update {update.latest} available</span>
      ) : null}
      {update.latest && !update.installing ? <span fg={theme.dim}> (u)</span> : null}
    </text>
  );
}
