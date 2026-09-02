import { useState } from "react";
import { homedir } from "node:os";
import { useKeyboard } from "@opentui/react";
import { Option } from "effect";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { AI_OPTIONS, newProject, roomProjects, shortRoomId, type LocalState, type Project } from "@collagen/p2p";
import { upsertActiveRoom, writeProfileFile } from "../profileFile";
import { SetupForm } from "./Setup";
import {
  aiStatusAtom,
  currentProfile,
  currentRoom,
  identityAtom,
  logsAtom,
  mcpUrlAtom,
  recentMessagesAtom,
  rosterAtom,
  stateAtom,
  updateStateAtom,
} from "./atoms";
import { FsPicker, Panel } from "./components";
import { theme } from "./theme";

type Mode = "room" | "projects" | "pick" | "settings";

const emptyState: LocalState = { preferredAi: null, rooms: {} };

function nextAi(current: string | null): string | null {
  // null -> claude-code -> codex -> null …
  const cycle: (string | null)[] = [null, ...AI_OPTIONS];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length] ?? null;
}

/** One row in the room's project list: the union of everyone's projects.
 *  Active (white) when 2+ participants share the name — that's where
 *  cross-agent work can happen; single-holder projects are greyed out. */
interface ProjectRow {
  name: string;
  mine: Project | undefined;
  holders: string[];
}

export function App({ onExit }: { onExit: () => void }) {
  const room = currentRoom();
  const ROOM = room.id;
  const [mode, setMode] = useState<Mode>("room");
  const [cursor, setCursor] = useState(0);

  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => emptyState);
  const messages = AsyncResult.getOrElse(useAtomValue(recentMessagesAtom), () => [] as const);
  const logs = AsyncResult.getOrElse(useAtomValue(logsAtom), () => [] as const);
  const mcpUrl = AsyncResult.getOrElse(useAtomValue(mcpUrlAtom), () => Option.none<string>());
  const aiStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const updateState = useAtomSet(updateStateAtom);

  const myProjects = roomProjects(state, ROOM);

  // Union of the room's projects by name, with who holds each.
  const rows: ProjectRow[] = (() => {
    const byName = new Map<string, ProjectRow>();
    for (const p of myProjects) byName.set(p.name, { name: p.name, mine: p, holders: ["you"] });
    for (const peer of peers) {
      for (const pp of peer.projects) {
        const row = byName.get(pp.name) ?? { name: pp.name, mine: undefined, holders: [] };
        row.holders.push(peer.name);
        byName.set(pp.name, row);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();
  const sharedCount = rows.filter((r) => r.holders.length >= 2).length;

  // Projects belong to the room they were added in (Keet-style).
  const deleteProject = (id: string) =>
    updateState((s: LocalState) => ({
      ...s,
      rooms: { ...s.rooms, [ROOM]: (s.rooms[ROOM] ?? []).filter((p) => p.id !== id) },
    }));

  // Picked a folder: add to this room (dedupe by path within the room).
  const addFolder = (name: string, path: string) => {
    updateState((s: LocalState) => {
      const here = s.rooms[ROOM] ?? [];
      if (here.some((p) => p.path === path)) return s;
      return { ...s, rooms: { ...s.rooms, [ROOM]: [...here, newProject(name, path)] } };
    });
    setMode("projects");
  };

  // The sidebar's last row is always "+ add project", so adding is just
  // arrows + enter — no chorded keys to remember.
  const itemCount = rows.length + 1;

  // One handler, gated by focus; pick mode is handled by FsPicker's own hook.
  useKeyboard((key) => {
    if (mode === "room") {
      if (key.name === "q") return onExit();
      if (key.name === "a")
        return updateState((s: LocalState) => ({ ...s, preferredAi: nextAi(s.preferredAi) }));
      if (key.name === "right" || key.name === "tab" || key.name === "p") {
        setCursor(0);
        setMode("projects");
        return;
      }
      if (key.name === "s") {
        setSettingsSaved(false);
        setMode("settings");
      }
      return;
    }
    if (mode === "settings") {
      if (key.name === "escape") return setMode("room");
      return;
    }
    if (mode === "projects") {
      if (key.name === "escape" || key.name === "left" || key.name === "tab") return setMode("room");
      if (key.name === "n") return setMode("pick");
      if (key.name === "up" || key.name === "k") return setCursor((i) => Math.max(0, i - 1));
      if (key.name === "down" || key.name === "j")
        return setCursor((i) => Math.min(itemCount - 1, i + 1));
      const i = Math.min(cursor, itemCount - 1);
      if (key.name === "return" && i === rows.length) return setMode("pick");
      const row = rows[i];
      if (!row) return;
      // only your own projects can be removed
      if (key.name === "d" && row.mine) return deleteProject(row.mine.id);
    }
  });

  if (mode === "settings") {
    return (
      <box flexDirection="column">
        <SetupForm
          title={`settings — profile "${currentProfile()}"`}
          initialName={identity?.name ?? ""}
          initialRoomName={room.name}
          initialRoomId={room.id}
          note={settingsSaved ? "saved — restart collagen to apply" : "changes apply on next start · esc back"}
          onDone={({ name, roomName, roomId }) => {
            writeProfileFile(currentProfile(), { name });
            upsertActiveRoom(currentProfile(), { id: roomId.length > 0 ? roomId : room.id, name: roomName });
            setSettingsSaved(true);
          }}
        />
      </box>
    );
  }

  return (
    <box flexDirection="column" padding={1} height="100%">
      <ascii-font text="collagen" font="tiny" color={theme.accent} />
      <text fg={theme.dim}>peer-to-peer</text>
      <text>
        <span fg={theme.dim}>you </span>
        <span fg={theme.fg}>{identity?.name ?? "…"}</span>
        <span fg={theme.dim}> · ai </span>
        <span fg={state.preferredAi ? theme.warn : theme.dim}>{state.preferredAi ?? "not set"}</span>
        {state.preferredAi && aiStatus !== "ok" && aiStatus !== "unknown" ? (
          <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthenticated"})</span>
        ) : null}
      </text>

      {/* the room IS the container: everything in it — peers, projects,
          messages — lives inside this box. It absorbs all free vertical
          space so the footer stays pinned and resizes don't reflow. */}
      <box marginTop={1} flexDirection="column" flexGrow={1} flexShrink={1}>
        <Panel title={`room · ${room.name}`} grow>
          <text>
            <span fg={theme.fg}>{peers.length + 1} online</span>
            <span fg={theme.dim}> · </span>
            <span fg={theme.fg}>{sharedCount} shared</span>
            <span fg={theme.dim}> {sharedCount === 1 ? "project" : "projects"}</span>
          </text>
          {mode === "pick" ? (
            /* the picker earns the whole room area — folder trees are wide */
            <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1}>
              <Panel title="pick a folder" color={theme.accent} grow>
                <FsPicker start={homedir()} onPick={addFolder} onCancel={() => setMode("projects")} />
              </Panel>
            </box>
          ) : (
          <box flexDirection="row" gap={2} marginTop={1} flexGrow={1} flexShrink={1}>
            <box flexDirection="column" flexGrow={1} flexShrink={1}>
              <PeerLine name={`${identity?.name ?? "…"} (you)`} ai={state.preferredAi} aiStatus={aiStatus} />
              {peers.map((p) => (
                <PeerLine key={p.key} name={p.name} ai={p.ai} aiStatus={p.aiStatus} />
              ))}
              {messages.length > 0 ? (
                <box flexDirection="column" marginTop={1}>
                  <text fg={theme.dim}>messages</text>
                  {messages.slice(-5).map((m) => (
                    <text key={m.id} fg={theme.fg} truncate>
                      <span fg={theme.warn}>← {m.fromName}</span>
                      <span fg={theme.dim}> [{m.project}/{m.intent}] </span>
                      {m.findings}
                    </text>
                  ))}
                </box>
              ) : null}
            </box>

            <box flexDirection="column" width={34} flexShrink={0}>
              <Panel
                title="projects"
                color={mode === "projects" ? theme.accent : theme.dim}
                grow
              >
                <box flexDirection="column">
                    {rows.map((row, i) => {
                      const active = row.holders.length >= 2;
                      const selected = mode === "projects" && i === cursor;
                      return (
                        <text key={row.name} fg={selected ? theme.accent : active ? theme.fg : theme.dim} truncate>
                          {selected ? "› " : "  "}
                          {row.name}
                          <span fg={theme.dim}> — {row.holders.join(", ")}</span>
                        </text>
                      );
                    })}
                    <text
                      fg={mode === "projects" && Math.min(cursor, itemCount - 1) === rows.length ? theme.accent : theme.dim}
                      truncate
                    >
                      {mode === "projects" && Math.min(cursor, itemCount - 1) === rows.length ? "› " : "  "}+ add project
                    </text>
                    {mode !== "projects" && rows.length === 0 ? (
                      <text fg={theme.dim} truncate>
                        press → to get started
                      </text>
                    ) : null}
                </box>
              </Panel>
            </box>
          </box>
          )}
        </Panel>
      </box>

      <box marginTop={1} flexDirection="column" flexShrink={0}>
        <text fg={theme.dim}>activity</text>
        {[0, 1, 2].map((i) => {
          const line = logs.slice(-3)[i] ?? " ";
          return (
            <text key={i} fg={theme.dim} truncate>
              {line}
            </text>
          );
        })}
      </box>

      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.dim} truncate>
          mcp: {Option.getOrElse(mcpUrl, () => "starting…")}
        </text>
        <text fg={theme.dim} truncate>
          room: <span fg={theme.fg}>{room.name}</span> [{shortRoomId(room.id)}] · invite id: <span fg={theme.fg}>{room.id}</span>
        </text>
        <text fg={theme.dim}>
          {mode === "room"
            ? "→ projects · a cycle ai · s settings · q quit"
            : mode === "projects"
              ? "↑↓ select · enter add · d remove yours · ← back"
              : "esc back"}
        </text>
      </box>
    </box>
  );
}

function PeerLine({ name, ai, aiStatus }: { name: string; ai: string | null; aiStatus?: string }) {
  const bad = ai !== null && aiStatus !== undefined && aiStatus !== "ok" && aiStatus !== "unknown";
  return (
    <text>
      <span fg={bad ? theme.warn : theme.ok}>● </span>
      <span fg={theme.fg}>{name}</span>
      <span fg={theme.dim}> {ai ?? "—"}</span>
      {bad ? <span fg={theme.warn}> ({aiStatus === "missing" ? "cli not found" : "unauthed"})</span> : null}
    </text>
  );
}
