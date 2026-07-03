import { useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { homedir } from "node:os";
import { Option } from "effect";
import { Result, useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import { AI_OPTIONS, newProject, roomProjects, type LocalState } from "@collagen/p2p";
import { ROOM } from "../services/AppLayer";
import {
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

type Mode = "room" | "projects" | "pick";

const emptyState: LocalState = { preferredAi: null, pool: [], rooms: {} };

function nextAi(current: string | null): string | null {
  // null -> claude-code -> codex -> null …
  const cycle: (string | null)[] = [null, ...AI_OPTIONS];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length] ?? null;
}

export function App() {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [mode, setMode] = useState<Mode>("room");
  const [cursor, setCursor] = useState(0);

  const identity = Result.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = Result.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const state = Result.getOrElse(useAtomValue(stateAtom), () => emptyState);
  const messages = Result.getOrElse(useAtomValue(recentMessagesAtom), () => [] as const);
  const logs = Result.getOrElse(useAtomValue(logsAtom), () => [] as const);
  const mcpUrl = Result.getOrElse(useAtomValue(mcpUrlAtom), () => Option.none<string>());
  const updateState = useAtomSet(updateStateAtom);

  const enabled = roomProjects(state, ROOM);
  const enabledIds = new Set(state.rooms[ROOM] ?? []);
  const myProjectNames = new Set(enabled.map((p) => p.name));

  const toggleProject = (id: string) =>
    updateState((s: LocalState) => {
      const ids = new Set(s.rooms[ROOM] ?? []);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ...s, rooms: { ...s.rooms, [ROOM]: [...ids] } };
    });

  const deleteProject = (id: string) =>
    updateState((s: LocalState) => {
      const rooms: Record<string, string[]> = {};
      for (const [r, ids] of Object.entries(s.rooms)) rooms[r] = ids.filter((x) => x !== id);
      return { ...s, pool: s.pool.filter((p) => p.id !== id), rooms };
    });

  // Picked a folder: add to pool (dedupe by path) and enable it in this room.
  const addFolder = (name: string, path: string) => {
    updateState((s: LocalState) => {
      const existing = s.pool.find((p) => p.path === path);
      const proj = existing ?? newProject(name, path);
      const pool = existing ? s.pool : [...s.pool, proj];
      const ids = new Set(s.rooms[ROOM] ?? []);
      ids.add(proj.id);
      return { ...s, pool, rooms: { ...s.rooms, [ROOM]: [...ids] } };
    });
    setMode("projects");
  };

  // ── room-mode keys ──
  useInput(
    (input) => {
      if (input === "q") return exit();
      if (input === "a") return updateState((s: LocalState) => ({ ...s, preferredAi: nextAi(s.preferredAi) }));
      if (input === "p") {
        setCursor(0);
        setMode("projects");
      }
    },
    { isActive: Boolean(mode === "room" && isRawModeSupported) },
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
    { isActive: Boolean(mode === "projects" && isRawModeSupported) },
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
        <Text color={theme.fg}>{identity?.name ?? "…"}</Text>
        <Text color={theme.dim}> · ai </Text>
        <Text color={state.preferredAi ? theme.warn : theme.dim}>{state.preferredAi ?? "not set"}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column" gap={1}>
        {/* room / presence */}
        <Panel title={`room · ${ROOM}`}>
          <Text color={theme.dim}>{peers.length + 1} online</Text>
          <Box flexDirection="column" marginTop={1}>
            <PeerLine
              name={`${identity?.name ?? "…"} (you)`}
              ai={state.preferredAi}
              projects={enabled.map((p) => p.name)}
              mine={myProjectNames}
            />
            {peers.map((p) => (
              <PeerLine key={p.key} name={p.name} ai={p.ai} projects={p.projects.map((x) => x.name)} mine={myProjectNames} />
            ))}
          </Box>
          {messages.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={theme.dim}>messages</Text>
              {messages.slice(-5).map((m) => (
                <Text key={m.id} color={theme.fg} wrap="truncate-end">
                  <Text color={theme.warn}>← {m.fromName}</Text>
                  <Text color={theme.dim}> [{m.project}/{m.intent}] </Text>
                  {m.findings}
                </Text>
              ))}
            </Box>
          ) : null}
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

      {logs.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>activity</Text>
          {logs.slice(-3).map((l, i) => (
            <Text key={i} color={theme.dim} wrap="truncate-end">
              {l}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <Text color={theme.dim} wrap="truncate-end">
          mcp: {Option.getOrElse(mcpUrl, () => "starting…")}
        </Text>
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
  projects: ReadonlyArray<string>;
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
            // all projects are real; accent just flags ones you also have (shared)
            <Text key={`${p}-${i}`} color={mine.has(p) ? theme.accent : theme.fg} bold={mine.has(p)}>
              {p}
              {i < projects.length - 1 ? " " : ""}
            </Text>
          ))}
        </Text>
      ) : null}
    </Box>
  );
}
