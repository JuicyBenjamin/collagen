import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import type { Identity } from "../identity";
import { joinRoom, type Bootstrap, type Peer, type PresenceHandle, type SharedProfile } from "../peers";
import {
  AI_OPTIONS,
  loadState,
  newProject,
  roomProjects,
  saveState,
  type LocalState,
} from "../store";
import { homedir } from "node:os";
import { FsPicker, Panel } from "./components";
import { theme } from "./theme";

const ROOM = "lobby";
type Mode = "room" | "projects" | "pick";

function nextAi(current: string | null): string | null {
  // null -> claude-code -> codex -> null …
  const cycle: (string | null)[] = [null, ...AI_OPTIONS];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length] ?? null;
}

export function App({ identity, bootstrap }: { identity: Identity; bootstrap?: Bootstrap }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [state, setState] = useState<LocalState>(() => loadState(identity.profile));
  const [peers, setPeers] = useState<Peer[]>([]);
  const [mode, setMode] = useState<Mode>("room");
  const [cursor, setCursor] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const handleRef = useRef<PresenceHandle | null>(null);

  useEffect(() => {
    const getProfile = (): SharedProfile => ({
      name: identity.name,
      ai: stateRef.current.preferredAi,
      projects: roomProjects(stateRef.current, ROOM).map((p) => ({ name: p.name, path: p.path })),
    });
    const h = joinRoom(identity, ROOM, getProfile, setPeers, { bootstrap });
    handleRef.current = h;
    return () => {
      void h.destroy();
    };
  }, [identity, bootstrap]);

  function persist(next: LocalState) {
    setState(next);
    stateRef.current = next;
    saveState(identity.profile, next);
    handleRef.current?.update();
  }

  const enabled = roomProjects(state, ROOM);
  const enabledIds = new Set((state.rooms[ROOM] ?? []));
  const myProjectNames = new Set(enabled.map((p) => p.name));

  function toggleProject(id: string) {
    const ids = new Set(state.rooms[ROOM] ?? []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    persist({ ...state, rooms: { ...state.rooms, [ROOM]: [...ids] } });
  }
  function deleteProject(id: string) {
    const rooms: Record<string, string[]> = {};
    for (const [r, ids] of Object.entries(state.rooms)) rooms[r] = ids.filter((x) => x !== id);
    persist({ ...state, pool: state.pool.filter((p) => p.id !== id), rooms });
  }
  // Picked a folder: add to pool (dedupe by path) and enable it in this room.
  function addFolder(name: string, path: string) {
    const existing = state.pool.find((p) => p.path === path);
    const proj = existing ?? newProject(name, path);
    const pool = existing ? state.pool : [...state.pool, proj];
    const ids = new Set(state.rooms[ROOM] ?? []);
    ids.add(proj.id);
    persist({ ...state, pool, rooms: { ...state.rooms, [ROOM]: [...ids] } });
    setMode("projects");
  }

  // ── room-mode keys ──
  useInput(
    (input) => {
      if (input === "q") return exit();
      if (input === "a") return persist({ ...state, preferredAi: nextAi(state.preferredAi) });
      if (input === "p") {
        setCursor(0);
        setMode("projects");
      }
    },
    { isActive: mode === "room" && isRawModeSupported },
  );

  // ── projects-mode keys ──
  useInput(
    (input, key) => {
      if (key.escape) return setMode("room");
      if (input === "n") return setMode("pick");
      if (state.pool.length === 0) return;
      if (key.upArrow || input === "k") return setCursor((i) => Math.max(0, i - 1));
      if (key.downArrow || input === "j") return setCursor((i) => Math.min(state.pool.length - 1, i + 1));
      const p = state.pool[Math.min(cursor, state.pool.length - 1)];
      if (!p) return;
      if (input === " " || key.return) return toggleProject(p.id);
      if (input === "d") return deleteProject(p.id);
    },
    { isActive: mode === "projects" && isRawModeSupported },
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text bold color={theme.accent}>
          ◇ collagen
        </Text>
        <Text color={theme.dim}> peer-to-peer</Text>
      </Box>
      <Box>
        <Text color={theme.dim}>you </Text>
        <Text color={theme.fg}>{identity.name}</Text>
        <Text color={theme.dim}> · ai </Text>
        <Text color={state.preferredAi ? theme.warn : theme.dim}>{state.preferredAi ?? "not set"}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column" gap={1}>
        {/* room / presence */}
        <Panel title={`room · ${ROOM}`}>
          <Text color={theme.dim}>{peers.length + 1} online</Text>
          <Box flexDirection="column" marginTop={1}>
            <PeerLine name={`${identity.name} (you)`} ai={state.preferredAi} projects={enabled.map((p) => p.name)} mine={myProjectNames} />
            {peers.map((p) => (
              <PeerLine key={p.key} name={p.name} ai={p.ai} projects={p.projects.map((x) => x.name)} mine={myProjectNames} />
            ))}
          </Box>
        </Panel>

        {/* config / projects */}
        <Panel title={mode === "projects" ? "projects (this room)" : mode === "pick" ? "pick a folder" : "you"} color={mode === "room" ? theme.dim : theme.accent}>
          {mode === "pick" ? (
            <FsPicker start={homedir()} onPick={addFolder} onCancel={() => setMode("projects")} />
          ) : mode === "projects" ? (
            <Box flexDirection="column">
              {state.pool.length === 0 ? (
                <Text color={theme.dim}>no projects — n to add</Text>
              ) : (
                state.pool.map((p, i) => {
                  const on = enabledIds.has(p.id);
                  return (
                    <Text key={p.id} color={i === cursor ? theme.accent : theme.fg}>
                      {i === cursor ? "› " : "  "}
                      <Text color={on ? theme.ok : theme.dim}>{on ? "[x] " : "[ ] "}</Text>
                      {p.name} <Text color={theme.dim}>{p.path}</Text>
                    </Text>
                  );
                })
              )}
              <Text color={theme.dim} wrap="truncate">
                ↑↓ move · space toggle · n add · d delete · esc back
              </Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color={theme.dim}>preferred ai</Text>
              <Text color={state.preferredAi ? theme.warn : theme.dim}>{state.preferredAi ?? "not set"}</Text>
              <Box marginTop={1}>
                <Text color={theme.dim}>projects in room</Text>
              </Box>
              {enabled.length === 0 ? (
                <Text color={theme.dim}>none</Text>
              ) : (
                enabled.map((p) => (
                  <Text key={p.id} color={theme.fg}>
                    ◆ {p.name}
                  </Text>
                ))
              )}
            </Box>
          )}
        </Panel>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.dim}>
          {mode === "room" ? "a cycle ai · p projects · q quit" : "esc back to room"}
        </Text>
      </Box>
    </Box>
  );
}

function PeerLine({
  name,
  ai,
  projects,
  mine,
}: {
  name: string;
  ai: string | null;
  projects: string[];
  mine: Set<string>;
}) {
  return (
    <Box flexDirection="row">
      <Text color={theme.ok}>● </Text>
      <Text color={theme.fg}>{name}</Text>
      <Text color={theme.dim}> {ai ?? "—"}</Text>
      {projects.length > 0 ? (
        <Text>
          {" "}
          {projects.map((p, i) => (
            <Text key={`${p}-${i}`} color={mine.has(p) ? theme.accent : theme.dim}>
              {p}
              {i < projects.length - 1 ? " " : ""}
            </Text>
          ))}
        </Text>
      ) : null}
    </Box>
  );
}
