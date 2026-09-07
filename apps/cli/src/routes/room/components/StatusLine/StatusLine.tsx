import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { theme } from "../../../../app/theme";
import { myNameAtom } from "../../../atoms";
import { aiStatusAtom, stateAtom } from "../../atoms";

/** "you <name> · ai <choice> (auth badge)" — the one-line identity summary. */
export function StatusLine() {
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "…");
  const ai = AsyncResult.getOrElse(useAtomValue(stateAtom), () => ({ preferredAi: null })).preferredAi;
  const aiStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const bad = ai !== null && aiStatus !== "ok" && aiStatus !== "unknown";

  return (
    <text truncate wrapMode="none">
      <span fg={theme.dim}>you </span>
      <span fg={theme.fg}>{myName}</span>
      <span fg={theme.dim}> · ai </span>
      <span fg={ai ? theme.warn : theme.dim}>{ai ?? "not set"}</span>
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthenticated"})</span> : null}
    </text>
  );
}
