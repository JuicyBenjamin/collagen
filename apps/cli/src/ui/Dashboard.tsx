import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { authClient } from "../auth/client";
import { Panel } from "./components";
import { theme } from "./theme";
import { useTeams } from "./useTeams";
import { usePresence } from "./usePresence";

export interface Org {
  id: string;
  name: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type Focus = "org" | "rooms";
type Mode = "nav" | "create-org" | "create-room";

export function Dashboard({ who, onLogout }: { who: string; onLogout: () => void }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [orgCursor, setOrgCursor] = useState(0);

  const [focus, setFocus] = useState<Focus>("rooms");
  const [mode, setMode] = useState<Mode>("nav");
  const [draft, setDraft] = useState("");

  const [roomCursor, setRoomCursor] = useState(0);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const { teams, reload: reloadTeams } = useTeams(activeOrgId);
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const activeRoom = teams.find((t) => t.id === activeRoomId) ?? null;
  const members = usePresence(activeRoomId, who);

  const refreshOrgs = useCallback(async () => {
    const session = await authClient.getSession();
    const list = await authClient.organization.list();
    const os = (list.data ?? []) as Org[];
    setOrgs(os);
    setActiveOrgId((prev) => prev ?? session.data?.session?.activeOrganizationId ?? os[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refreshOrgs();
  }, [refreshOrgs]);

  // Switching org resets the room selection.
  useEffect(() => {
    setActiveRoomId(null);
    setRoomCursor(0);
  }, [activeOrgId]);

  async function switchOrg(id: string) {
    await authClient.organization.setActive({ organizationId: id });
    setActiveOrgId(id);
    setFocus("rooms");
  }

  async function createOrg() {
    if (!draft.trim()) return;
    const r = await authClient.organization.create({ name: draft, slug: slugify(draft) });
    setDraft("");
    setMode("nav");
    if (!r.error && r.data?.id) {
      await refreshOrgs();
      await switchOrg(r.data.id);
    }
  }

  async function createRoom() {
    if (!draft.trim() || !activeOrgId) return;
    const r = await authClient.organization.createTeam({ name: draft, organizationId: activeOrgId });
    setDraft("");
    setMode("nav");
    if (!r.error) await reloadTeams();
  }

  useKeyboard((e) => {
    if (mode !== "nav") {
      if (e.name === "escape") {
        setMode("nav");
        setDraft("");
      }
      return; // input handles typing
    }
    if (e.name === "q") return process.exit(0);
    if (e.name === "l") return onLogout();
    if (e.name === "tab") return setFocus((f) => (f === "org" ? "rooms" : "org"));

    if (focus === "org") {
      if (e.name === "n") return setMode("create-org");
      if (e.name === "up" || e.name === "k") setOrgCursor((i) => Math.max(0, i - 1));
      if (e.name === "down" || e.name === "j") setOrgCursor((i) => Math.min(orgs.length - 1, i + 1));
      if (e.name === "return") {
        const o = orgs[orgCursor];
        if (o) void switchOrg(o.id);
      }
      return;
    }

    // focus === "rooms"
    if (!activeOrgId) return;
    if (e.name === "n") return setMode("create-room");
    if (e.name === "up" || e.name === "k") setRoomCursor((i) => Math.max(0, i - 1));
    if (e.name === "down" || e.name === "j") setRoomCursor((i) => Math.min(teams.length - 1, i + 1));
    if (e.name === "return") {
      const t = teams[roomCursor];
      if (t) setActiveRoomId(t.id);
    }
  });

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", padding: 1 }}>
      <box style={{ alignItems: "center" }}>
        <ascii-font text="collagen" font="tiny" color={theme.accent} />
      </box>

      <box style={{ flexDirection: "row", flexGrow: 1, marginTop: 1 }}>
        {/* left column — 1fr */}
        <box style={{ flexDirection: "column", flexBasis: 0, flexGrow: 1, marginRight: 1 }}>
          <Panel title="org" focused={focus === "org"}>
            {mode === "create-org" ? (
              <box style={{ flexDirection: "column" }}>
                <input
                  placeholder="org name"
                  value={draft}
                  focused
                  onInput={setDraft}
                  onSubmit={() => void createOrg()}
                />
                <text style={{ fg: theme.dim }}>enter create · esc cancel</text>
              </box>
            ) : focus === "org" ? (
              orgs.length === 0 ? (
                <text style={{ fg: theme.dim }}>no orgs — n to create</text>
              ) : (
                orgs.map((o, i) => {
                  const isCursor = i === orgCursor;
                  const isActive = o.id === activeOrgId;
                  return (
                    <box key={o.id} style={{ flexDirection: "row" }}>
                      <text style={{ fg: theme.accent }}>{isCursor ? "› " : "  "}</text>
                      <text style={{ fg: theme.ok }}>{isActive ? "● " : "  "}</text>
                      <text style={{ fg: isActive ? theme.ok : theme.fg }}>{o.name}</text>
                    </box>
                  );
                })
              )
            ) : (
              <box style={{ flexDirection: "column" }}>
                <text style={{ fg: theme.fg }}>{activeOrg?.name ?? "no org"}</text>
                <text style={{ fg: theme.dim }}>{who}</text>
              </box>
            )}
          </Panel>

          <Panel title="rooms" grow={1} focused={focus === "rooms"}>
            {mode === "create-room" ? (
              <box style={{ flexDirection: "column" }}>
                <input
                  placeholder="room name"
                  value={draft}
                  focused
                  onInput={setDraft}
                  onSubmit={() => void createRoom()}
                />
                <text style={{ fg: theme.dim }}>enter create · esc cancel</text>
              </box>
            ) : !activeOrgId ? (
              <text style={{ fg: theme.dim }}>select an org first</text>
            ) : teams.length === 0 ? (
              <text style={{ fg: theme.dim }}>no rooms — n to create</text>
            ) : (
              teams.map((t, i) => {
                const isCursor = i === roomCursor && focus === "rooms";
                const isOpen = t.id === activeRoomId;
                return (
                  <box key={t.id} style={{ flexDirection: "row" }}>
                    <text style={{ fg: theme.accent }}>{isCursor ? "› " : "  "}</text>
                    <text style={{ fg: theme.ok }}>{isOpen ? "● " : "  "}</text>
                    <text style={{ fg: isOpen ? theme.ok : theme.fg }}>{t.name}</text>
                  </box>
                );
              })
            )}
          </Panel>

          <box style={{ flexDirection: "column", marginTop: 1 }}>
            <text style={{ fg: theme.dim }}>tab switch · ↑↓ move · enter select · n new</text>
            <text style={{ fg: theme.dim }}>l log out · q quit</text>
          </box>
        </box>

        {/* right column — 3fr: open room + who's in it */}
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
              <text style={{ fg: theme.dim }}>select a room on the left and press enter</text>
            )}
          </Panel>
        </box>
      </box>
    </box>
  );
}
