#!/usr/bin/env node
// Mock agent: stands in for a real LLM CLI on machines without one, so a
// second device can be a full peer in a real cross-network test. It walks the
// exact path a real agent would — MCP handshake, get-messages, send-to-peer —
// only the "thinking" is canned. Spawned by the `mock` adapter; argv:
//   mcpUrl threadId fromName project intent session
// `session` is the runner's stored session id for this thread — ours encode
// the ack count as "mock#N", which is the only state the mock needs.
const [mcpUrl, threadId, fromName, project, intent, session] = process.argv.slice(2);

const PROTOCOL = "2025-06-18";
const baseHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": PROTOCOL,
};

/** One JSON-RPC POST; unwraps SSE-framed responses. Returns {sid, json}. */
async function rpc(body, session) {
  const headers = session ? { ...baseHeaders, "mcp-session-id": session } : baseHeaders;
  const res = await fetch(mcpUrl, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  const text = await res.text();
  let json;
  if ((res.headers.get("content-type") ?? "").includes("event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).pop();
    json = data ? JSON.parse(data.slice(5)) : undefined;
  } else if (text.trim().length > 0) {
    json = JSON.parse(text);
  }
  return { sid, json };
}

const toolText = (r) => r.json?.result?.content?.[0]?.text ?? "";

async function main() {
  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "collagen-mock-agent", version: "0.0.0" },
    },
  });
  // NOT named `session` — that would shadow the argv ack-count carrier
  const mcpSession = init.sid ?? undefined;
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, mcpSession);
  const call = (id, name, args) =>
    rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, mcpSession);

  const messages = toolText(await call(2, "get-messages", { threadId }));

  // Reply to pings, but capped per thread and never to another mock's ack —
  // otherwise two mocks (or a polite real agent) ping-pong forever.
  const MAX_ACKS = 3;
  const acked = session?.startsWith("mock#") ? Number(session.slice(5)) || 0 : 0;
  let replied = false;
  if (acked < MAX_ACKS && !intent.startsWith("mock")) {
    const r = toolText(
      await call(3, "send-to-peer", {
        peer: fromName,
        project,
        intent: "mock-ack",
        findings: `mock agent here — received your "${intent}" message and read the thread (${messages.length} chars). p2p round-trip verified at ${new Date().toISOString()}.`,
      }),
    );
    // tool text arrives JSON-quoted ('"sent to alice"')
    replied = r.includes("sent to");
  }

  console.log(
    JSON.stringify({
      session_id: `mock#${replied ? acked + 1 : acked}`,
      result: `mock agent: read thread${
        replied
          ? `, replied via send-to-peer (ack ${acked + 1}/${MAX_ACKS})`
          : acked >= MAX_ACKS
            ? `, ack cap reached (${MAX_ACKS})`
            : ", not acking a mock message"
      }`,
    }),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ result: `mock agent error: ${String(e)}` }));
});
