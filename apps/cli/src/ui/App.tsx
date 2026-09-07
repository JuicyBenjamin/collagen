import { useEffect, useRef, useState } from "react";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { Option } from "effect";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  AI_OPTIONS,
  deriveThreadId,
  newProject,
  roomProjects,
  shortRoomId,
  type LocalState,
  type Project,
  type RoomMessage,
  type Ticket,
} from "@collagen/p2p";
import { writeProfileFile } from "../profileFile";
import { MOCK_AI_OPTIONS } from "../services/Adapters";
import { SetupForm } from "./Setup";
import {
  aiStatusAtom,
  currentProfile,
  currentRoom,
  identityAtom,
  logsAtom,
  mcpUrlAtom,
  recentMessagesAtom,
  myNameAtom,
  renameRoomAtom,
  roomMetaAtom,
  setMyNameAtom,
  rosterAtom,
  sentMessagesAtom,
  stateAtom,
  ticketsAtom,
  updateStateAtom,
} from "./atoms";
import { FsPicker, Panel, isEnter, keyDebug } from "./components";
import { theme } from "./theme";

type Mode = "room" | "pick" | "settings";
/** Room tabs: the overview is what a person cares about (who's here, what's
 *  shared, what's in flight); the message log is the agent-to-agent trace. */
type Tab = "overview" | "messages";
const TABS: ReadonlyArray<Tab> = ["overview", "messages"];

/** Spatial focus: every section is a place the cursor can land. Arrows move
 *  between sections by direction, and inside the hovered section they do
 *  the natural thing (switch tab, pick a row, scroll). Number keys jump tabs
 *  from anywhere; letters are global accelerators. */
type Focus = "tabs" | "tickets" | "projects" | "messages";

const STEP_GLYPH: Record<Ticket["steps"][number]["status"], string> = {
  pending: "·",
  suspended: "⟳",
  settled: "✓",
  failed: "✗",
};

const emptyState: LocalState = { preferredAi: null, rooms: {} };

function nextAi(current: string | null): string | null {
  // null -> claude-code -> codex -> mock:claude-code -> mock:codex -> null …
  // the mocks let a machine without an LLM CLI participate; the mock: prefix
  // is broadcast so peers see there's no real AI behind it.
  const cycle: (string | null)[] = [null, ...AI_OPTIONS, ...MOCK_AI_OPTIONS];
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

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function App({ onExit }: { onExit: () => void }) {
  const room = currentRoom();
  const ROOM = room.id;
  const [mode, setMode] = useState<Mode>("room");
  const [tab, setTab] = useState<Tab>("overview");
  const [focus, setFocus] = useState<Focus>("tabs");
  const [projCursor, setProjCursor] = useState(0);
  const [ticketCursor, setTicketCursor] = useState(0);
  // null = follow the newest message until the user scrolls
  const [msgCursor, setMsgCursor] = useState<number | null>(null);
  // one expanded item (ticket id or message id) shows its full detail inline
  const [expanded, setExpanded] = useState<string | null>(null);
  // first visible row of the message list — a ref, not state: it's derived
  // from the cursor each render and must not itself trigger renders
  const msgStartRef = useRef(0);
  const { height: termHeight } = useTerminalDimensions();

  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => emptyState);
  const inbound = AsyncResult.getOrElse(useAtomValue(recentMessagesAtom), () => [] as const);
  const outbound = AsyncResult.getOrElse(useAtomValue(sentMessagesAtom), () => [] as const);
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  // The a2a trace: both directions, chronological.
  const trace: ReadonlyArray<{ msg: RoomMessage; out: boolean }> = [
    ...inbound.map((msg) => ({ msg, out: false })),
    ...outbound.map((msg) => ({ msg, out: true })),
  ].sort((a, b) => a.msg.ts - b.msg.ts);
  // A sent message records no recipient, but its thread id is derived from
  // (me, peer, project) — so the peer is recoverable from the roster.
  const peerNameFor = (m: RoomMessage): string => {
    if (!identity) return "peer";
    const hit = peers.find((p) => deriveThreadId(identity.pubkey, p.key, m.project) === m.threadId);
    return hit?.name ?? inbound.find((i) => i.threadId === m.threadId)?.fromName ?? "peer";
  };
  const nameFor = (key: string): string =>
    key === identity?.pubkey ? "you" : (peers.find((p) => p.key === key)?.name ?? key.slice(0, 8));
  const logs = AsyncResult.getOrElse(useAtomValue(logsAtom), () => [] as const);
  const mcpUrl = AsyncResult.getOrElse(useAtomValue(mcpUrlAtom), () => Option.none<string>());
  const aiStatus = AsyncResult.getOrElse(useAtomValue(aiStatusAtom), () => "unknown" as const);
  // shared name: live view of what the room agreed on (broadcast LWW)
  const roomName = AsyncResult.getOrElse(useAtomValue(roomMetaAtom), () => ({ name: room.name, ts: 0 })).name;
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const renderer = useRenderer();
  const updateState = useAtomSet(updateStateAtom);
  const renameRoom = useAtomSet(renameRoomAtom);
  const setMyName = useAtomSet(setMyNameAtom);
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => identity?.name ?? "…");

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyInvite = () => {
    // OSC 52 puts it on the terminal's clipboard (works over ssh); pbcopy is
    // the local fallback for terminals that block OSC 52.
    renderer.copyToClipboardOSC52(room.id);
    if (process.platform === "darwin") {
      const child = execFile("pbcopy");
      child.stdin?.end(room.id);
    }
    setCopied(true);
  };

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
  // The sidebar's last row is always "+ add project", so adding is just
  // arrows + enter — no chorded keys to remember.
  const projCount = rows.length + 1;
  const projSel = clamp(projCursor, 0, projCount - 1);
  const ticketSel = clamp(ticketCursor, 0, Math.max(0, tickets.length - 1));
  const msgSel = msgCursor === null ? trace.length - 1 : clamp(msgCursor, 0, Math.max(0, trace.length - 1));

  // Projects belong to the room they were added in (Keet-style).
  const deleteProject = (id: string) =>
    updateState({
      update: (s) => ({
        ...s,
        rooms: { ...s.rooms, [ROOM]: (s.rooms[ROOM] ?? []).filter((p) => p.id !== id) },
      }),
    });

  // Picked a folder: add to this room (dedupe by path within the room).
  const addFolder = (name: string, path: string) => {
    updateState({
      update: (s) => {
        const here = s.rooms[ROOM] ?? [];
        if (here.some((p) => p.path === path)) return s;
        return { ...s, rooms: { ...s.rooms, [ROOM]: [...here, newProject(name, path)] } };
      },
    });
    setMode("room");
    setFocus("projects");
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setFocus("tabs");
    setExpanded(null);
  };
  const stepTab = (dir: -1 | 1) => switchTab(TABS[clamp(TABS.indexOf(tab) + dir, 0, TABS.length - 1)]!);
  /** Where ↓ from the tab bar lands: the content section of the current tab. */
  const contentOf = (t: Tab): Focus => (t === "overview" ? "tickets" : "messages");

  // One handler; pick mode is handled by FsPicker's own hook, settings by its form.
  useKeyboard((key) => {
    keyDebug(`app:${mode}:${focus}`, key);
    if (mode === "settings") {
      if (key.name === "escape") return setMode("room");
      return;
    }
    if (mode !== "room") return;

    // ── global accelerators: work wherever the cursor is ──
    if (key.name === "q") return onExit();
    if (key.name === "a") return updateState({ update: (s) => ({ ...s, preferredAi: nextAi(s.preferredAi) }) });
    if (key.name === "c") return copyInvite();
    if (key.name === "s") {
      setSettingsSaved(false);
      return setMode("settings");
    }
    if (key.name === "1") return switchTab("overview");
    if (key.name === "2") return switchTab("messages");
    if (key.name === "escape") {
      setExpanded(null);
      return setFocus("tabs");
    }

    // ── section-local behaviour ──
    switch (focus) {
      case "tabs": {
        if (key.name === "left") return stepTab(-1);
        if (key.name === "right") return stepTab(1);
        if (key.name === "down" || isEnter(key)) return setFocus(contentOf(tab));
        return;
      }
      case "tickets": {
        if (key.name === "up") return ticketSel > 0 ? setTicketCursor(ticketSel - 1) : setFocus("tabs");
        if (key.name === "down") return setTicketCursor(clamp(ticketSel + 1, 0, Math.max(0, tickets.length - 1)));
        if (key.name === "right") return setFocus("projects");
        if (isEnter(key)) {
          const t = tickets[ticketSel];
          if (t) setExpanded((e) => (e === t.id ? null : t.id));
        }
        return;
      }
      case "projects": {
        if (key.name === "up") return projSel > 0 ? setProjCursor(projSel - 1) : setFocus("tabs");
        if (key.name === "down") return setProjCursor(clamp(projSel + 1, 0, projCount - 1));
        if (key.name === "left") return setFocus("tickets");
        if (isEnter(key) && projSel === rows.length) return setMode("pick");
        const row = rows[projSel];
        // only your own projects can be removed
        if (key.name === "d" && row?.mine) return deleteProject(row.mine.id);
        return;
      }
      case "messages": {
        if (key.name === "up") return msgSel > 0 ? setMsgCursor(msgSel - 1) : setFocus("tabs");
        if (key.name === "down") {
          // scrolling back to the newest message resumes following
          return msgSel >= trace.length - 1 ? setMsgCursor(null) : setMsgCursor(msgSel + 1);
        }
        if (isEnter(key)) {
          const m = trace[msgSel]?.msg;
          if (m) setExpanded((e) => (e === m.id ? null : m.id));
        }
        return;
      }
    }
  });

  if (mode === "settings") {
    return (
      <box flexDirection="column">
        <SetupForm
          title={`settings — profile "${currentProfile()}"`}
          initialName={myName}
          initialRoomName={roomName}
          roomId={room.id}
          note={settingsSaved ? "saved — applies now" : "changes apply live · esc back"}
          onDone={({ name, roomName: newRoomName }) => {
            writeProfileFile(currentProfile(), { name });
            if (name !== myName) setMyName({ name });
            // renaming is shared state — broadcast to the whole room
            if (newRoomName !== roomName) renameRoom({ name: newRoomName });
            setSettingsSaved(true);
          }}
        />
      </box>
    );
  }

  const hint = (() => {
    if (mode === "pick") return "↑↓ move · → open · ← up · enter pick · esc cancel";
    switch (focus) {
      case "tabs":
        return "←→ switch tab · ↓ into the tab · 1/2 jump · a cycle ai · c copy invite · s settings · q quit";
      case "tickets":
        return "↑↓ select ticket · enter details · → projects · ↑ tabs · esc";
      case "projects":
        return "↑↓ select · enter add · d remove yours · ← tickets · ↑ tabs · esc";
      case "messages":
        return "↑↓ scroll · enter full text · ↑ tabs · 1/2 jump · esc";
    }
  })();

  const sectionColor = (f: Focus) => (focus === f && mode === "room" ? theme.accent : theme.dim);
  const msgWindow = Math.max(5, termHeight - 16 - (expanded ? 3 : 0));
  // Sticky viewport: the list only scrolls when the cursor hits an edge, so a
  // keypress redraws one or two rows — not the whole panel. Following mode
  // (msgCursor null) keeps the newest message on the bottom row.
  const maxStart = Math.max(0, trace.length - msgWindow);
  let msgStart = msgCursor === null ? maxStart : clamp(msgStartRef.current, 0, maxStart);
  if (msgSel < msgStart) msgStart = msgSel;
  if (msgSel >= msgStart + msgWindow) msgStart = msgSel - msgWindow + 1;
  msgStartRef.current = msgStart;

  return (
    <box flexDirection="column" padding={1} height="100%">
      <ascii-font text="collagen" font="tiny" color={theme.accent} />
      <text fg={theme.dim}>peer-to-peer</text>
      <text truncate wrapMode="none">
        <span fg={theme.dim}>you </span>
        <span fg={theme.fg}>{myName}</span>
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
        <Panel title={`room · ${roomName}`} grow>
          {/* tab bar — a section: hover it and ←→ switch, ↓ enters the tab */}
          <text truncate wrapMode="none">
            <span fg={sectionColor("tabs")}>{focus === "tabs" ? "› " : "  "}</span>
            <span fg={tab === "overview" ? theme.accent : theme.dim}>[1] overview</span>
            <span fg={theme.dim}>   </span>
            <span fg={tab === "messages" ? theme.accent : theme.dim}>[2] messages</span>
            <span fg={theme.dim}> ({trace.length})</span>
            <span fg={theme.dim}>   ·   </span>
            <span fg={theme.fg}>{peers.length + 1} online</span>
            <span fg={theme.dim}> · </span>
            <span fg={theme.fg}>{sharedCount} shared</span>
            <span fg={theme.dim}> {sharedCount === 1 ? "project" : "projects"}</span>
          </text>

          {tab === "messages" ? (
            <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1}>
              <text fg={sectionColor("messages")}>
                agent-to-agent trace · ← received · → sent · newest last
              </text>
              {trace.length === 0 ? (
                <text fg={theme.dim}>no messages yet</text>
              ) : (
                trace.slice(msgStart, msgStart + msgWindow).map(({ msg, out }, i) => {
                  const selected = focus === "messages" && msgStart + i === msgSel;
                  const open = expanded === msg.id;
                  return (
                    <box key={msg.id} flexDirection="column">
                      <text fg={selected ? theme.accent : theme.fg} truncate={!open} wrapMode={open ? "word" : "none"}>
                        {selected ? "› " : "  "}
                        <span fg={out ? theme.accent : theme.warn}>
                          {out ? "→ " : "← "}
                          {out ? peerNameFor(msg) : msg.fromName}
                        </span>
                        <span fg={theme.dim}> [{msg.project}/{msg.intent}] </span>
                        {open ? "" : msg.findings}
                      </text>
                      {open ? (
                        <box paddingLeft={4}>
                          <text fg={theme.fg}>{msg.findings}</text>
                        </box>
                      ) : null}
                    </box>
                  );
                })
              )}
            </box>
          ) : (
            <box flexDirection="row" gap={2} marginTop={1} flexGrow={1} flexShrink={1}>
              <box flexDirection="column" flexGrow={1} flexShrink={1}>
                <PeerLine name={`${myName} (you)`} ai={state.preferredAi} aiStatus={aiStatus} />
                {peers.map((p) => (
                  <PeerLine key={p.key} name={p.name} ai={p.ai} aiStatus={p.aiStatus} />
                ))}
                {/* tickets — a section: hover it and ↑↓ select, enter shows steps */}
                <box flexDirection="column" marginTop={1}>
                  <text fg={sectionColor("tickets")}>{focus === "tickets" ? "› " : "  "}tickets</text>
                  {tickets.length === 0 ? (
                    <text fg={theme.dim}>  none — agents create them for multi-step work</text>
                  ) : (
                    tickets.slice(-8).map((t, i) => {
                      const idx = tickets.length - Math.min(8, tickets.length) + i;
                      const selected = focus === "tickets" && idx === ticketSel;
                      const done = t.steps.filter((s) => s.status === "settled").length;
                      const open = expanded === t.id;
                      return (
                        <box key={t.id} flexDirection="column">
                          <text fg={selected ? theme.accent : done === t.steps.length ? theme.dim : theme.fg} truncate wrapMode="none">
                            {selected ? "› " : "  "}
                            <span fg={theme.warn}>⧉ </span>
                            {t.goal}
                            <span fg={theme.dim}> · {t.project} · {done}/{t.steps.length} </span>
                            <span fg={theme.dim}>{t.steps.map((s) => STEP_GLYPH[s.status]).join(" ")}</span>
                          </text>
                          {open
                            ? t.steps.map((s) => (
                                <text key={s.id} fg={theme.dim} truncate wrapMode="none">
                                  {"      "}
                                  <span fg={s.status === "settled" ? theme.ok : s.status === "failed" ? theme.warn : theme.dim}>
                                    {STEP_GLYPH[s.status]}
                                  </span>{" "}
                                  {s.id} {nameFor(s.owner)} · {s.intent} — {s.result ?? s.description}
                                </text>
                              ))
                            : null}
                        </box>
                      );
                    })
                  )}
                </box>
              </box>

              {/* projects — a section: hover it and ↑↓ select, enter adds */}
              <box flexDirection="column" width={34} flexShrink={0}>
                <Panel
                  title={mode === "pick" ? "pick a folder" : "projects"}
                  color={mode === "pick" ? theme.accent : sectionColor("projects")}
                  grow
                >
                  {mode === "pick" ? (
                    <FsPicker
                      start={homedir()}
                      onPick={addFolder}
                      onCancel={() => {
                        setMode("room");
                        setFocus("projects");
                      }}
                    />
                  ) : (
                    <box flexDirection="column">
                      {rows.map((row, i) => {
                        const active = row.holders.length >= 2;
                        const selected = focus === "projects" && i === projSel;
                        return (
                          <text key={row.name} fg={selected ? theme.accent : active ? theme.fg : theme.dim} truncate wrapMode="none">
                            {selected ? "› " : "  "}
                            {row.name}
                            <span fg={theme.dim}> — {row.holders.join(", ")}</span>
                          </text>
                        );
                      })}
                      <text fg={focus === "projects" && projSel === rows.length ? theme.accent : theme.dim} truncate wrapMode="none">
                        {focus === "projects" && projSel === rows.length ? "› " : "  "}+ add project
                      </text>
                    </box>
                  )}
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
            <text key={i} fg={theme.dim} truncate wrapMode="none">
              {line}
            </text>
          );
        })}
      </box>

      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.dim} truncate wrapMode="none">
          mcp: {Option.getOrElse(mcpUrl, () => "starting…")}
        </text>
        <text fg={theme.dim} truncate wrapMode="none">
          room: <span fg={theme.fg}>{roomName}</span> [{shortRoomId(room.id)}] · invite id:{" "}
          <span fg={theme.fg}>{room.id}</span>
          {copied ? <span fg={theme.ok}>  ✓ copied</span> : <span fg={theme.dim}>  (c to copy)</span>}
        </text>
        <text fg={theme.dim} truncate wrapMode="none">
          {hint}
        </text>
      </box>
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
