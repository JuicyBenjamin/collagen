import { parseArgs } from "node:util";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { devLogin, getToken, initToken } from "./auth/client";
import { setProfile } from "./auth/store";
import { App } from "./ui/App";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    // Dev: act as a seeded user (alice|bob). Namespaces the token file and
    // auto-logs-in, so two terminals can run as two users at once.
    user: { type: "string", short: "u" },
  },
  allowPositionals: true,
});

if (values.user) setProfile(values.user);
await initToken();
if (values.user && !getToken()) await devLogin(values.user);

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
