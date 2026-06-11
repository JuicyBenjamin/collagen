import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { authClient, getToken, logout } from "../auth/client";
import { Login } from "./Login";
import { Dashboard } from "./Dashboard";

export function App() {
  const [loggedIn, setLoggedIn] = useState<boolean>(!!getToken());
  const [who, setWho] = useState<string | null>(null);

  useKeyboard((e) => {
    if (e.ctrl && e.name === "c") process.exit(0);
  });

  useEffect(() => {
    if (!loggedIn) {
      setWho(null);
      return;
    }
    void authClient.getSession().then((res) => {
      const user = res.data?.user;
      setWho(user ? (user.name || user.email) : null);
    });
  }, [loggedIn]);

  function doLogout() {
    void logout().then(() => setLoggedIn(false));
  }

  if (!loggedIn) return <Login onSuccess={() => setLoggedIn(true)} />;

  return <Dashboard who={who ?? "anon"} onLogout={doLogout} />;
}
