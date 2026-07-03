import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { homedir } from "node:os";
import { appendFileSync } from "node:fs";
import {
  AI_OPTIONS,
  joinRoom,
  newProject,
  roomProjects,
  type Bootstrap,
  type Identity,
  type LocalState,
  type Peer,
  type RoomHandle,
  type RoomMessage,
  type SharedProfile,
} from "@collagen/p2p";
import { loadState, saveState } from "../store";
import { startMcpServer, type McpHandle } from "../mcp";
import { spawnAgent } from "../spawn";
import { mcpServerName, portForProfile, registerCodexMcp, registerMcpGlobally } from "../mcpconfig";
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
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [mcpUrl, setMcpUrl] = useState("");
  const [mode, setMode] = useState<Mode>("room");
  const [cursor, setCursor] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const handleRef = useRef<RoomHandle | null>(null);
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = peers;
  const queueRef = useRef<RoomMessage[]>([]); // incoming, drained by get-messages
  const mcpUrlRef = useRef("");
  mcpUrlRef.current = mcpUrl;
  const threadSessions = useRef(new Map<string, string>()); // threadId -> ai sessionId
  const threadBusy = useRef(new Set<string>()); // serialize spawns per thread

  const log = (line: string) => {
    setLogs((prev) => [...prev.slice(-20), line]);
    // Headless debugging: the ink UI is invisible on non-TTY stdout, so mirror
    // activity to a file when COLLAGEN_LOG is set.
    if (process.env.COLLAGEN_LOG) {
      try {
        appendFileSync(process.env.COLLAGEN_LOG, `${new Date().toISOString()} ${line}\n`);
      } catch {
        // best-effort
      }
    }
  };

  // Run (or continue) the recipient AI for a thread, serialized so we never
  // resume one AI session concurrently (that corrupts the transcript).
  function runThread(threadId: string) {
    if (threadBusy.current.has(threadId)) return; // re-checked on close
    const sample = queueRef.current.find((m) => m.threadId === threadId);
    if (!sample) return;
    if (!mcpUrlRef.current) return log("message before MCP ready");
    threadBusy.current.add(threadId);
    const before = new Set(queueRef.current.filter((m) => m.threadId === threadId).map((m) => m.id));
    const proj = stateRef.current.pool.find((p) => p.name === sample.project);
    const sessionId = threadSessions.current.get(threadId);
    const ai = stateRef.current.preferredAi ?? "claude-code";
    log(`${sessionId ? "continue" : "start"} ${ai} · ${sample.fromName}/${sample.project}`);
    spawnAgent({
      ai: stateRef.current.preferredAi,
      cwd: proj?.path ?? homedir(),
      mcpUrl: mcpUrlRef.current,
      serverName: mcpServerName(identity.profile),
      msg: sample,
      sessionId,
      onSession: (sid) => threadSessions.current.set(threadId, sid),
      onLog: log,
      onClose: () => {
        threadBusy.current.delete(threadId);
        // a message that arrived DURING the run (new id) → run again
        if (queueRef.current.some((m) => m.threadId === threadId && !before.has(m.id))) {
          runThread(threadId);
        }
      },
    });
  }

  // Local MCP server: lets the user's AI list the room, send to peers, and read
  // incoming messages. Started once; reads live state via refs.
  useEffect(() => {
    let handle: McpHandle | null = null;
    void startMcpServer({
      listRoom: () =>
        peersRef.current.map((p) => ({ name: p.name, ai: p.ai, projects: p.projects.map((x) => x.name) })),
      sendToPeer: (peer, project, intent, findings) => {
        const target = peersRef.current.find((p) => p.name === peer);
        if (!target) return { ok: false, error: `no peer named ${peer}` };
        const ok = handleRef.current?.sendTo(target.key, { project, intent, findings }) ?? false;
        return ok ? { ok: true } : { ok: false, error: "peer not connected" };
      },
      takeMessages: (threadId?: string) => {
        if (!threadId) {
          const m = queueRef.current;
          queueRef.current = [];
          return m;
        }
        const mine = queueRef.current.filter((m) => m.threadId === threadId);
        queueRef.current = queueRef.current.filter((m) => m.threadId !== threadId);
        return mine;
      },
    }, portForProfile(identity.profile)).then((h) => {
      handle = h;
      setMcpUrl(h.url);
      // Register in both supported AIs' user configs → available in every repo,
      // nothing written into the user's projects.
      const name = mcpServerName(identity.profile);
      registerMcpGlobally(name, h.url, log); // claude
      registerCodexMcp(name, h.url, log); // codex
    });
    return () => {
      void handle?.close();
    };
  }, []);

  useEffect(() => {
    const getProfile = (): SharedProfile => ({
      name: identity.name,
      ai: stateRef.current.preferredAi,
      projects: roomProjects(stateRef.current, ROOM).map((p) => ({ name: p.name, path: p.path })),
    });
    const h = joinRoom(
      identity,
      ROOM,
      getProfile,
      {
        onRoster: setPeers,
        onMessage: (m) => {
          setMessages((prev) => [...prev, m]);
          queueRef.current.push(m); // available to get-messages
          runThread(m.threadId); // start or continue this thread's AI session
        },
      },
      { bootstrap },
    );
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
          mcp: {mcpUrl || "starting…"}
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
