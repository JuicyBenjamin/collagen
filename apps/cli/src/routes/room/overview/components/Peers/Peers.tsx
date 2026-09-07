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
        <PeerLine key={p.key} name={p.name} ai={p.ai} aiStatus={p.aiStatus} away={p.away} />
      ))}
    </box>
  );
}

function PeerLine({ name, ai, aiStatus, away }: { name: string; ai: string | null; aiStatus?: string; away?: boolean }) {
  const bad = ai !== null && aiStatus !== undefined && aiStatus !== "ok" && aiStatus !== "unknown";
  return (
    <text truncate wrapMode="none">
      <span fg={away ? theme.dim : bad ? theme.warn : theme.ok}>{away ? "○ " : "● "}</span>
      <span fg={away ? theme.dim : theme.fg}>{name}</span>
      {away ? <span fg={theme.dim}> (away)</span> : null}
      <span fg={theme.dim}> {ai ?? "—"}</span>
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthed"})</span> : null}
    </text>
  );
}
