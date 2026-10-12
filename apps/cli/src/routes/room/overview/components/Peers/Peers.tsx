import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { PROTOCOL_VERSION } from "@collagen/p2p";
import { theme } from "../../../../../app/theme";
import { myNameAtom, roomAtom } from "../../../../atoms";
import { aiStatusAtom, rosterAtom, stateAtom } from "../../../atoms";

/** Everyone in the room, you first, with each one's agent, its auth badge
 *  and how many projects they share here (the projects tab lists them). */
export function Peers() {
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "…");
  const state = useAtomValue(stateAtom);
  const myAi = AsyncResult.getOrElse(state, () => ({ preferredAi: null })).preferredAi;
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const myProjects = AsyncResult.isSuccess(state) ? (state.value.rooms[roomId] ?? []).length : 0;
  const myStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);

  return (
    <box flexDirection="column">
      <PeerLine name={`${myName} (you)`} ai={myAi} aiStatus={myStatus} projects={myProjects} />
      {peers.map((p) => (
        <PeerLine key={p.key} name={p.name} ai={p.ai} aiStatus={p.aiStatus} away={p.away} protocol={p.protocol} projects={p.projects.length} />
      ))}
    </box>
  );
}

function PeerLine({
  name,
  ai,
  aiStatus,
  away,
  protocol = PROTOCOL_VERSION,
  projects,
}: {
  name: string;
  ai: string | null;
  aiStatus?: string;
  away?: boolean;
  /** absent on our own line; a peer's protocol version */
  protocol?: string;
  projects: number;
}) {
  const bad = ai !== null && aiStatus !== undefined && aiStatus !== "ok" && aiStatus !== "unknown";
  const mismatch = protocol !== PROTOCOL_VERSION;
  return (
    <text truncate wrapMode="none">
      <span fg={away ? theme.dim : bad ? theme.warn : theme.ok}>{away ? "○ " : "● "}</span>
      <span fg={away ? theme.dim : theme.fg}>{name}</span>
      {away ? <span fg={theme.dim}> (away)</span> : null}
      <span fg={theme.dim}> {ai ?? "—"}</span>
      {projects > 0 ? <span fg={theme.dim}> · {projects} {projects === 1 ? "project" : "projects"}</span> : null}
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthed"})</span> : null}
      {mismatch ? <span fg={theme.warn}> ⚠ other collagen version</span> : null}
    </text>
  );
}
