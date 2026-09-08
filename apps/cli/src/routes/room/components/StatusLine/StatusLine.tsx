import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { theme } from "../../../../app/theme";
import { myNameAtom } from "../../../atoms";
import { aiStatusAtom, appUpdateAtom, stateAtom } from "../../atoms";

/** "you <name> · ai <choice> (auth badge) · update … (u)" — the one-line status. */
export function StatusLine() {
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "…");
  const ai = AsyncResult.getOrElse(useAtomValue(stateAtom), () => ({ preferredAi: null })).preferredAi;
  const aiStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const bad = ai !== null && aiStatus !== "ok" && aiStatus !== "unknown";
  const update = AsyncResult.getOrElse(useAtomValue(appUpdateAtom), () => ({ latest: null, installing: false, note: null }));

  return (
    <text truncate wrapMode="none">
      <span fg={theme.dim}>you </span>
      <span fg={theme.fg}>{myName}</span>
      <span fg={theme.dim}> · ai </span>
      <span fg={ai ? theme.warn : theme.dim}>{ai ?? "not set"}</span>
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthenticated"})</span> : null}
      {update.note ? (
        <span fg={update.installing ? theme.warn : theme.dim}> · {update.note}</span>
      ) : update.latest ? (
        <span fg={theme.warn}> · update {update.latest} available</span>
      ) : null}
      {update.latest && !update.installing ? <span fg={theme.dim}> (u)</span> : null}
    </text>
  );
}
