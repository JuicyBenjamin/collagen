import { Elysia } from "elysia";
import { auth } from "./auth";
import { PresenceRegistry } from "./presence";
import { clientMessage, serverMessage, wsQuery } from "./protocol";

const PORT = Number(process.env.PORT ?? 3000);

const presence = new PresenceRegistry();

// Per-socket data stashed on open so close() knows who left.
interface SocketData {
  workspaceId: string;
  clientId: string;
}

const app = new Elysia()
  // better-auth handles all /api/auth/* routes (sign-up, session, org, teams).
  .mount(auth.handler)
  .get("/", () => ({ service: "collagen-server", ok: true }))
  .get("/presence/:workspace", ({ params }) => ({
    workspaceId: params.workspace,
    online: presence.roster(params.workspace).length,
  }))
  .ws("/ws", {
    query: wsQuery,
    body: clientMessage,
    response: serverMessage,
    open(ws) {
      // workspace = a better-auth team id. Identity is client-asserted for now
      // (the cli sends the signed-in user's name); WS auth-gating comes later.
      const workspaceId = ws.data.query.workspace;
      const name = ws.data.query.name ?? "anon";
      const clientId = crypto.randomUUID();
      (ws.data as { socket?: SocketData }).socket = { workspaceId, clientId };

      presence.join(workspaceId, clientId, name, {
        send: (message) => ws.send(message),
      });

      ws.send({ type: "welcome", workspaceId, clientId, members: presence.roster(workspaceId) });
      presence.broadcast(workspaceId, {
        type: "presence",
        workspaceId,
        members: presence.roster(workspaceId),
      });
    },
    message(ws, message) {
      // Validated against clientMessage before we get here.
      if (message.type === "ping") ws.send({ type: "pong" });
    },
    close(ws) {
      const socket = (ws.data as { socket?: SocketData }).socket;
      if (!socket) return;
      presence.leave(socket.workspaceId, socket.clientId);
      presence.broadcast(socket.workspaceId, {
        type: "presence",
        workspaceId: socket.workspaceId,
        members: presence.roster(socket.workspaceId),
      });
    },
  })
  .listen(PORT);

console.log(`collagen-server listening on http://localhost:${app.server?.port}`);

export type App = typeof app;
