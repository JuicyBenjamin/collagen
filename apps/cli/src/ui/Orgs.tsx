import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { authClient } from "../auth/client";
import { Card, Field, Screen, Status } from "./components";
import { theme } from "./theme";

export interface Org {
  id: string;
  name: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Orgs({ orgs, onPicked }: { orgs: Org[]; onPicked: () => void }) {
  const [mode, setMode] = useState<"list" | "create">(orgs.length ? "list" : "create");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function activate(id: string) {
    const r = await authClient.organization.setActive({ organizationId: id });
    if (r.error) {
      setErr(r.error.message ?? "could not switch org");
      return;
    }
    onPicked();
  }

  async function create() {
    if (!name.trim()) {
      setErr("name required");
      return;
    }
    const r = await authClient.organization.create({ name, slug: slugify(name) });
    if (r.error) {
      setErr(r.error.message ?? "could not create org");
      return;
    }
    if (r.data?.id) await activate(r.data.id);
  }

  useKeyboard((e) => {
    if (mode !== "list") return;
    if (e.name === "n") {
      setErr(null);
      setMode("create");
      return;
    }
    const n = Number(e.name);
    if (Number.isInteger(n) && n >= 1 && n <= orgs.length) {
      void activate(orgs[n - 1]!.id);
    }
  });

  if (mode === "create") {
    return (
      <Screen>
        <Card title="collagen">
          <text style={{ fg: theme.dim }}>
            {orgs.length ? "create a new org" : "no org yet — create one"}
          </text>
          <Field label="org name" focused>
            <input
              placeholder="Acme Inc"
              value={name}
              focused
              onInput={setName}
              onSubmit={() => void create()}
            />
          </Field>
          {err ? <Status kind="error">✗ {err}</Status> : <Status kind="dim">enter to create</Status>}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card title="collagen">
        <text style={{ fg: theme.dim }}>select an org</text>
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          {orgs.map((o, i) => (
            <box key={o.id} style={{ flexDirection: "row" }}>
              <text style={{ fg: theme.accent }}>{`${i + 1}. `}</text>
              <text style={{ fg: theme.fg }}>{o.name}</text>
            </box>
          ))}
        </box>
        {err ? <Status kind="error">✗ {err}</Status> : <Status kind="dim">number = select · n = new org</Status>}
      </Card>
    </Screen>
  );
}
