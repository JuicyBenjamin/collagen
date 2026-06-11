import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { authClient } from "../auth/client";
import { Panel } from "./components";
import { theme } from "./theme";
import { useTeams } from "./useTeams";
import { usePresence } from "./usePresence";
import type { Org } from "./Orgs";

export function Dashboard({
  org,
  who,
  onLogout,
  onSwitchOrg,
}: {
  org: Org;
  who: string;
  onLogout: () => void;
  onSwitchOrg: () => void;
}) {
  const { teams, reload } = useTeams(org.id);
  const [cursor, setCursor] = useState(0); // highlighted row (selector)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null); // opened room
  const [mode, setMode] = useState<"nav" | "create">("nav");
  const [name, setName] = useState("");

  const activeRoom = teams.find((t) => t.id === activeRoomId) ?? null;
  const members = usePresence(activeRoomId, who);

  async function createRoom() {
    if (!name.trim()) return;
    const r = await authClient.organization.createTeam({ name, organizationId: org.id });
    setName("");
    setMode("nav");
    if (!r.error) await reload();
  }

  useKeyboard((e) => {
    if (mode === "create") {
      if (e.name === "escape") {
        setMode("nav");
        setName("");
      }
      return; // input handles typing
    }
    if (e.name === "q") return process.exit(0);
    if (e.name === "l") return onLogout();
    if (e.name === "o") return onSwitchOrg();
    if (e.name === "n") return setMode("create");
    if (e.name === "up" || e.name === "k") setCursor((i) => Math.max(0, i - 1));
    if (e.name === "down" || e.name === "j") setCursor((i) => Math.min(teams.length - 1, i + 1));
    if (e.name === "return") {
      const t = teams[cursor];
      if (t) setActiveRoomId(t.id);
    }
  });

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", padding: 1 }}>
      {/* header */}
      <box style={{ alignItems: "center" }}>
        <ascii-font text="collagen" font="tiny" color={theme.accent} />
      </box>

      {/* grid */}
      <box style={{ flexDirection: "row", flexGrow: 1, marginTop: 1 }}>
        {/* left column — 1fr: org + rooms list */}
        <box style={{ flexDirection: "column", flexBasis: 0, flexGrow: 1, marginRight: 1 }}>
        <Panel title="org">
          <text style={{ fg: theme.fg }}>{org.name}</text>
          <text style={{ fg: theme.dim }}>{who}</text>
        </Panel>
        <Panel title="rooms" grow={1}>
          {mode === "create" ? (
            <box style={{ flexDirection: "column" }}>
              <text style={{ fg: theme.accent }}>new room</text>
              <input
                placeholder="room name"
                value={name}
                focused
                onInput={setName}
                onSubmit={() => void createRoom()}
              />
              <text style={{ fg: theme.dim }}>enter to create · esc to cancel</text>
            </box>
          ) : teams.length === 0 ? (
            <text style={{ fg: theme.dim }}>no rooms — press n to create one</text>
          ) : (
            teams.map((t, i) => {
              const isCursor = i === cursor;
              const isOpen = t.id === activeRoomId;
              const fg = isOpen ? theme.ok : isCursor ? theme.accent : theme.fg;
              return (
                <box key={t.id} style={{ flexDirection: "row" }}>
                  <text style={{ fg: theme.accent }}>{isCursor ? "› " : "  "}</text>
                  <text style={{ fg: theme.ok }}>{isOpen ? "● " : "  "}</text>
                  <text style={{ fg }}>{t.name}</text>
                </box>
              );
            })
          )}
        </Panel>
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          <text style={{ fg: theme.dim }}>↑↓ move · enter open room · n new room</text>
          <text style={{ fg: theme.dim }}>o switch org · l log out · q quit</text>
        </box>
      </box>

        {/* right column — 3fr: the open room (workspace) + who's in it */}
        <box style={{ flexDirection: "column", flexBasis: 0, flexGrow: 3 }}>
        <Panel title={activeRoom ? activeRoom.name : "room"} grow={1} focused={!!activeRoom}>
          {activeRoom ? (
            <box style={{ flexDirection: "column" }}>
              <text style={{ fg: theme.dim }}>{`${members.length} in this room`}</text>
              <box style={{ flexDirection: "column", marginTop: 1 }}>
                {members.length === 0 ? (
                  <text style={{ fg: theme.dim }}>nobody here yet</text>
                ) : (
                  members.map((m) => (
                    <box key={m.clientId} style={{ flexDirection: "row" }}>
                      <text style={{ fg: theme.ok }}>● </text>
                      <text style={{ fg: theme.fg }}>{m.name}</text>
                    </box>
                  ))
                )}
              </box>
            </box>
          ) : (
            <text style={{ fg: theme.dim }}>select a room on the left and press enter to open it</text>
          )}
        </Panel>
      </box>
      </box>
    </box>
  );
}
