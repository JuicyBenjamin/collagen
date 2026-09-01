import { useState } from "react";
import { homedir } from "node:os";
import { useKeyboard } from "@opentui/react";
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
import { FsPicker, isSpace, Panel } from "./components";
import { theme } from "./theme";

type Mode = "room" | "projects" | "pick";

const emptyState: LocalState = { preferredAi: null, pool: [], rooms: {} };

function nextAi(current: string | null): string | null {
  // null -> claude-code -> codex -> null …
  const cycle: (string | null)[] = [null, ...AI_OPTIONS];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length] ?? null;
}

export function App({ onExit }: { onExit: () => void }) {
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

  // One handler, gated by mode; pick mode is handled by FsPicker's own hook.
  useKeyboard((key) => {
    if (mode === "room") {
      if (key.name === "q") return onExit();
      if (key.name === "a")
        return updateState((s: LocalState) => ({ ...s, preferredAi: nextAi(s.preferredAi) }));
      if (key.name === "p") {
        setCursor(0);
        setMode("projects");
      }
      return;
    }
    if (mode === "projects") {
      if (key.name === "escape") return setMode("room");
      if (key.name === "n") return setMode("pick");
      if (state.pool.length === 0) return;
      if (key.name === "up" || key.name === "k") return setCursor((i) => Math.max(0, i - 1));
      if (key.name === "down" || key.name === "j")
        return setCursor((i) => Math.min(state.pool.length - 1, i + 1));
      const p = state.pool[Math.min(cursor, state.pool.length - 1)];
      if (!p) return;
      if (isSpace(key) || key.name === "return") return toggleProject(p.id);
      if (key.name === "d") return deleteProject(p.id);
    }
  });

  return (
    <box flexDirection="column" padding={1}>
      <ascii-font text="collagen" font="tiny" color={theme.accent} />
      <text fg={theme.dim}>peer-to-peer</text>
      <text>
        <span fg={theme.dim}>you </span>
        <span fg={theme.fg}>{identity?.name ?? "…"}</span>
        <span fg={theme.dim}> · ai </span>
        <span fg={state.preferredAi ? theme.warn : theme.dim}>{state.preferredAi ?? "not set"}</span>
      </text>

      <box marginTop={1} flexDirection="column" gap={1}>
        {/* room / presence */}
        <Panel title={`room · ${ROOM}`}>
          <text fg={theme.dim}>{peers.length + 1} online</text>
          <box flexDirection="column" marginTop={1}>
            <PeerLine
              name={`${identity?.name ?? "…"} (you)`}
              ai={state.preferredAi}
              projects={enabled.map((p) => p.name)}
              mine={myProjectNames}
            />
            {peers.map((p) => (
              <PeerLine key={p.key} name={p.name} ai={p.ai} projects={p.projects.map((x) => x.name)} mine={myProjectNames} />
            ))}
          </box>
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
        </Panel>

        {/* config / projects */}
        <Panel title={mode === "projects" ? "projects (this room)" : mode === "pick" ? "pick a folder" : "you"} color={mode === "room" ? theme.dim : theme.accent}>
          {mode === "pick" ? (
            <FsPicker start={homedir()} onPick={addFolder} onCancel={() => setMode("projects")} />
          ) : mode === "projects" ? (
            <box flexDirection="column">
              {state.pool.length === 0 ? (
                <text fg={theme.dim}>no projects — n to add</text>
              ) : (
                state.pool.map((p, i) => {
                  const on = enabledIds.has(p.id);
                  return (
                    <text key={p.id} fg={i === cursor ? theme.accent : theme.fg}>
                      {i === cursor ? "› " : "  "}
                      <span fg={on ? theme.ok : theme.dim}>{on ? "[x] " : "[ ] "}</span>
                      {p.name} <span fg={theme.dim}>{p.path}</span>
                    </text>
                  );
                })
              )}
              <text fg={theme.dim} truncate>
                ↑↓ move · space toggle · n add · d delete · esc back
              </text>
            </box>
          ) : (
            <box flexDirection="column">
              <text fg={theme.dim}>preferred ai</text>
              <text fg={state.preferredAi ? theme.warn : theme.dim}>{state.preferredAi ?? "not set"}</text>
              <box marginTop={1}>
                <text fg={theme.dim}>projects in room</text>
              </box>
              {enabled.length === 0 ? (
                <text fg={theme.dim}>none</text>
              ) : (
                enabled.map((p) => (
                  <text key={p.id} fg={theme.fg}>
                    ◆ {p.name}
                  </text>
                ))
              )}
            </box>
          )}
        </Panel>
      </box>

      {logs.length > 0 ? (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.dim}>activity</text>
          {logs.slice(-3).map((l, i) => (
            <text key={i} fg={theme.dim} truncate>
              {l}
            </text>
          ))}
        </box>
      ) : null}

      <box marginTop={1} flexDirection="column">
        <text fg={theme.dim} truncate>
          mcp: {Option.getOrElse(mcpUrl, () => "starting…")}
        </text>
        <text fg={theme.dim}>
          {mode === "room" ? "a cycle ai · p projects · q quit" : "esc back to room"}
        </text>
      </box>
    </box>
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
    <text>
      <span fg={theme.ok}>● </span>
      <span fg={theme.fg}>{name}</span>
      <span fg={theme.dim}> {ai ?? "—"}</span>
      {projects.length > 0 ? (
        <span>
          {" "}
          {projects.map((p, i) => {
            // all projects are real; accent just flags ones you also have (shared)
            const shared = mine.has(p);
            const label = `${p}${i < projects.length - 1 ? " " : ""}`;
            return shared ? (
              <b key={`${p}-${i}`} fg={theme.accent}>
                {label}
              </b>
            ) : (
              <span key={`${p}-${i}`} fg={theme.fg}>
                {label}
              </span>
            );
          })}
        </span>
      ) : null}
    </text>
  );
}
