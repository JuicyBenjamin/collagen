import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { theme } from "../../../../../app/theme";
import { myNameAtom } from "../../../../atoms";
import { aiStatusAtom, rosterAtom, stateAtom } from "../../../atoms";

/** Everyone in the room, you first, with each one's agent and its auth badge. */
export function Peers() {
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "…");
  const myAi = AsyncResult.getOrElse(useAtomValue(stateAtom), () => ({ preferredAi: null })).preferredAi;
  const myStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);

  return (
    <box flexDirection="column">
      <PeerLine name={`${myName} (you)`} ai={myAi} aiStatus={myStatus} />
      {peers.map((p) => (
        <PeerLine key={p.key} name={p.name} ai={p.ai} aiStatus={p.aiStatus} />
      ))}
    </box>
  );
}

function PeerLine({ name, ai, aiStatus }: { name: string; ai: string | null; aiStatus?: string }) {
  const bad = ai !== null && aiStatus !== undefined && aiStatus !== "ok" && aiStatus !== "unknown";
  return (
    <text truncate wrapMode="none">
      <span fg={bad ? theme.warn : theme.ok}>● </span>
      <span fg={theme.fg}>{name}</span>
      <span fg={theme.dim}> {ai ?? "—"}</span>
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthed"})</span> : null}
    </text>
  );
}
