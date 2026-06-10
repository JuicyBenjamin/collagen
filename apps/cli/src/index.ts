import { treaty } from "@elysiajs/eden";
import type { App } from "@collagen/server";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    server: { type: "string", short: "s", default: "localhost:3000" },
    workspace: { type: "string", short: "w" },
  },
  allowPositionals: true,
});

const workspace = values.workspace ?? positionals[0];
if (!workspace) {
  console.error("usage: collagen <workspace-slug> [--server host:port]");
  process.exit(1);
}

// Types (routes, message shapes) are derived from the server's App type.
const api = treaty<App>(values.server);

console.log(`connecting to ${values.server} (workspace "${workspace}") ...`);

const ws = api.ws.subscribe({ query: { workspace } });

let clientId = "";

ws.on("open", () => {
  console.log(`connected to workspace "${workspace}"`);
  setInterval(() => ws.send({ type: "ping" }), 30_000);
});

ws.subscribe(({ data }) => {
  switch (data.type) {
    case "welcome":
      clientId = data.clientId;
      render(data.online);
      break;
    case "presence":
      render(data.online);
      break;
    case "pong":
      break;
  }
});

ws.on("close", () => {
  console.log("\ndisconnected");
  process.exit(0);
});

ws.on("error", (event) => {
  console.error("socket error:", event);
  process.exit(1);
});

function render(online: number): void {
  const id = clientId ? ` (you: ${clientId.slice(0, 8)})` : "";
  console.log(`● ${online} online in "${workspace}"${id}`);
}
