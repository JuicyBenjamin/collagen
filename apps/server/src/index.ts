import { Elysia } from "elysia";
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
  .get("/", () => ({ service: "collagen-server", ok: true }))
  .get("/presence/:workspace", ({ params }) => ({
    workspaceId: params.workspace,
    online: presence.count(params.workspace),
  }))
  .ws("/ws", {
    query: wsQuery,
    body: clientMessage,
    response: serverMessage,
    open(ws) {
      // No tenant DB yet — treat the slug as the workspace id.
      const workspaceId = ws.data.query.workspace;
      const clientId = crypto.randomUUID();
      (ws.data as { socket?: SocketData }).socket = { workspaceId, clientId };

      const online = presence.join(workspaceId, clientId, {
        send: (message) => ws.send(message),
      });

      ws.send({ type: "welcome", workspaceId, clientId, online });
      presence.broadcast(workspaceId, { type: "presence", workspaceId, online });
    },
    message(ws, message) {
      // Validated against clientMessage before we get here.
      if (message.type === "ping") ws.send({ type: "pong" });
    },
    close(ws) {
      const socket = (ws.data as { socket?: SocketData }).socket;
      if (!socket) return;
      const online = presence.leave(socket.workspaceId, socket.clientId);
      presence.broadcast(socket.workspaceId, {
        type: "presence",
        workspaceId: socket.workspaceId,
        online,
      });
    },
  })
  .listen(PORT);

console.log(`collagen-server listening on http://localhost:${app.server?.port}`);

export type App = typeof app;
