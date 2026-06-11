import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { authClient } from "../auth/client";
import { Card, Field, Screen, Status } from "./components";
import { theme } from "./theme";

type FieldName = "email" | "password";
type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [field, setField] = useState<FieldName>("email");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(pwd: string) {
    if (!email || !pwd) {
      setState({ kind: "error", message: "email and password required" });
      return;
    }
    setState({ kind: "submitting" });
    const { error } = await authClient.signIn.email({ email, password: pwd });
    if (error) {
      setState({ kind: "error", message: error.message ?? "login failed" });
      setField("email");
      return;
    }
    onSuccess();
  }

  useKeyboard((e) => {
    if (e.name === "tab") {
      setField((f) => (f === "email" ? "password" : "email"));
      return;
    }
    // Password is a custom masked field — capture keys only while focused.
    if (field !== "password") return;
    if (e.name === "return") {
      setPassword((p) => {
        void submit(p);
        return p;
      });
      return;
    }
    if (e.name === "backspace") {
      setPassword((p) => p.slice(0, -1));
      return;
    }
    const ch = e.sequence;
    if (ch && ch.length === 1) {
      const code = ch.charCodeAt(0);
      if (code >= 32 && code !== 127 && !e.ctrl && !e.meta) {
        setPassword((p) => p + ch);
      }
    }
  });

  const masked = password.length > 0 ? "•".repeat(password.length) : "";

  return (
    <Screen>
      <Card title="collagen">
        <text style={{ fg: theme.dim }}>sign in to your account</text>

        <Field label="email" focused={field === "email"}>
          <input
            placeholder="you@example.com"
            value={email}
            focused={field === "email"}
            onInput={setEmail}
            onSubmit={() => setField("password")}
          />
        </Field>

        <Field label="password" focused={field === "password"}>
          <text style={{ fg: masked ? theme.fg : theme.dim }}>{masked || "•••••••"}</text>
        </Field>

        {state.kind === "error" ? (
          <Status kind="error">✗ {state.message}</Status>
        ) : state.kind === "submitting" ? (
          <Status kind="dim">signing in…</Status>
        ) : (
          <Status kind="dim">tab to switch · enter to submit</Status>
        )}
      </Card>
    </Screen>
  );
}
