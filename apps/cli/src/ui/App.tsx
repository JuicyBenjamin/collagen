import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { authClient, getToken, logout } from "../auth/client";
import { Login } from "./Login";
import { Orgs, type Org } from "./Orgs";
import { Dashboard } from "./Dashboard";
import { Card, Screen } from "./components";
import { theme } from "./theme";

export function App() {
  const [loggedIn, setLoggedIn] = useState<boolean>(!!getToken());
  const [who, setWho] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [forceOrgs, setForceOrgs] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const session = await authClient.getSession();
    const user = session.data?.user;
    setWho(user ? (user.name || user.email) : null);
    const activeId = session.data?.session?.activeOrganizationId ?? null;
    const list = await authClient.organization.list();
    const os = (list.data ?? []) as Org[];
    setOrgs(os);
    setActiveOrg(activeId ? (os.find((o) => o.id === activeId) ?? null) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loggedIn) void refresh();
  }, [loggedIn, refresh]);

  function doLogout() {
    void logout().then(() => {
      setLoggedIn(false);
      setActiveOrg(null);
      setWho(null);
    });
  }

  // Global escape hatch only; the Dashboard owns home-view keys (q/l/o/nav)
  // so they don't fire while typing in forms.
  useKeyboard((e) => {
    if (e.ctrl && e.name === "c") process.exit(0);
  });

  if (!loggedIn) return <Login onSuccess={() => setLoggedIn(true)} />;

  if (loading) {
    return (
      <Screen>
        <Card title="collagen">
          <text style={{ fg: theme.dim }}>loading…</text>
        </Card>
      </Screen>
    );
  }

  if (!activeOrg || forceOrgs) {
    return (
      <Orgs
        orgs={orgs}
        onPicked={() => {
          setForceOrgs(false);
          void refresh();
        }}
      />
    );
  }

  return (
    <Dashboard
      org={activeOrg}
      who={who ?? "anon"}
      onLogout={doLogout}
      onSwitchOrg={() => setForceOrgs(true)}
    />
  );
}
