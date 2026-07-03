import http from "node:http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RoomMessage } from "@collagen/p2p";

export interface RoomView {
  name: string;
  ai: string | null;
  projects: string[];
}

export interface McpDeps {
  /** Peers currently in the room (+ their shared projects). */
  listRoom: () => RoomView[];
  /** Route a finding to a peer by name. */
  sendToPeer: (peer: string, project: string, intent: string, findings: string) => { ok: boolean; error?: string };
  /** Drain queued incoming messages, optionally for one thread. */
  takeMessages: (threadId?: string) => RoomMessage[];
}

// A fresh server per request (stateless Streamable HTTP) — simplest correct mode.
function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "collagen", version: "0.0.0" });

  server.registerTool(
    "list-room",
    {
      description:
        "List the peers currently in your collagen room and the projects each shares. Call this first to discover who you can contact and about which project.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(deps.listRoom(), null, 2) }] }),
  );

  server.registerTool(
    "send-to-peer",
    {
      description:
        "Send a finding or request to a peer in the room about a specific project. The peer's AI will be triggered with your message. Use a 'peer' name and 'project' from list-room. 'intent' is a short verb like 'flag-issue' or 'ask-review'. 'findings' is the full context plus what you want from them.",
      inputSchema: {
        peer: z.string(),
        project: z.string(),
        intent: z.string(),
        findings: z.string(),
      },
    },
    async ({ peer, project, intent, findings }) => {
      const r = deps.sendToPeer(peer, project, intent, findings);
      return {
        content: [{ type: "text", text: r.ok ? `sent to ${peer}` : `failed: ${r.error ?? "unknown"}` }],
        isError: !r.ok,
      };
    },
  );

  server.registerTool(
    "get-messages",
    {
      description:
        "Retrieve and clear messages sent to you. Pass the threadId you were given to get just this conversation's messages. Each includes the sender, project, intent, and findings — use them to pick up the conversation and act on the request.",
      inputSchema: { threadId: z.string().optional() },
    },
    async ({ threadId }) => ({
      content: [{ type: "text", text: JSON.stringify(deps.takeMessages(threadId), null, 2) }],
    }),
  );

  return server;
}

export interface McpHandle {
  url: string;
  close: () => Promise<void>;
}

/** Start the cli's local MCP server. Tries `preferredPort` (stable per profile),
 *  falling back to an ephemeral port if it's taken. */
export async function startMcpServer(deps: McpDeps, preferredPort?: number): Promise<McpHandle> {
  const httpServer = http.createServer((req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      const server = buildServer(deps);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      server
        .connect(transport)
        .then(() => transport.handleRequest(req, res, parsed))
        .catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end();
          }
        });
    });
  });

  await new Promise<void>((resolve) => {
    const onErr = () => {
      httpServer.removeListener("error", onErr);
      httpServer.listen(0, "127.0.0.1", () => resolve()); // fallback: ephemeral
    };
    httpServer.once("error", onErr);
    httpServer.listen(preferredPort ?? 0, "127.0.0.1", () => {
      httpServer.removeListener("error", onErr);
      resolve();
    });
  });
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
