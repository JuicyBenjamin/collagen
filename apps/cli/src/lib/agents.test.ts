import { createServer } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { HttpRouter, HttpServer } from "effect/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it } from "vitest";
import { harnessOfClient } from "../services/Harness";
import { claudeCode } from "../services/harnesses/claudeCode";
import { claudeCall } from "../services/harnesses/claudeCode/call";
import { codex } from "../services/harnesses/codex";
import { codexCall } from "../services/harnesses/codex/call";
import { actingWith, actedBy, agentLabel, agentName, modelName, via } from "./agents";

const HARNESSES = [claudeCode, codex];
const acting = actingWith(HARNESSES);

describe("which agent is acting", () => {
  it("names the harnesses we know, and any other by its own title or name", () => {
    expect(agentName({ name: "claude-code" }, HARNESSES)).toBe("Claude Code");
    expect(agentName({ name: "codex-mcp-client", title: "Codex" }, HARNESSES)).toBe("Codex");
    expect(agentName({ name: "some-client", title: "Some Agent" }, HARNESSES)).toBe("Some Agent");
    expect(agentName({ name: "some-client" }, HARNESSES)).toBe("some-client");
    expect(agentName({ name: " " }, HARNESSES)).toBeUndefined();
    expect(agentName({ name: "x", title: "My\n  Agent" }, HARNESSES)).toBe("My Agent");
  });

  it("says it for an agent and for a person", () => {
    expect(actedBy("Juicy", "Codex")).toBe("Juicy's Codex");
    expect(actedBy("Juicy", undefined)).toBe("Juicy");
    expect(via("Codex")).toBe(" via Codex");
    expect(via(undefined)).toBe("");
  });

  it("takes the turn's model and effort as the call says them, and guesses nothing", () => {
    // as Codex 0.162 sends it with every tools/call
    const codex = { callId: "exec-1", threadId: "th", itemId: "it", "x-codex-turn-metadata": { turn_id: "tu", model: "gpt-6.1-sol", reasoning_effort: "medium" } };
    expect(codexCall(codex)).toEqual({ turn: { model: "gpt-6.1-sol", effort: "medium" }, thread: "th" });
    expect(codexCall({ progressToken: 1, "claudecode/toolUseId": "toolu_a" })).toBeNull();
    expect(codexCall({ progressToken: 1 })).toBeNull();
    expect(codexCall(undefined)).toBeNull();
  });

  it("finds Claude Code's call in its log by the id it sends, whatever else is near it, and the session that made it", () => {
    const entry = (id: string, at: string, model: string, effort: string, session: string, subagent?: string) =>
      `{"type":"assistant","timestamp":"${at}","sessionId":"${session}",${subagent ? `"agentId":"${subagent}","isSidechain":true,` : ""}"effort":"${effort}","message":{"model":"${model}","content":[{"type":"tool_use","id":"${id}","name":"mcp__collagen__post-review","input":{"ticketId":"t1"}}]}}`;
    // two sessions' calls a millisecond apart, the same tool and arguments
    const log = [entry("toolu_a", "2026-10-20T10:00:00.000Z", "claude-opus-5-5", "high", "s-1"), entry("toolu_b", "2026-10-20T10:00:00.001Z", "claude-haiku-5-5", "low", "s-2")].join("\n");
    expect(claudeCall(`half a line"}\n${log}`, "toolu_a")).toEqual({ turn: { model: "claude-opus-5-5", effort: "high" }, session: "s-1" });
    expect(claudeCall(log, "toolu_b")).toEqual({ turn: { model: "claude-haiku-5-5", effort: "low" }, session: "s-2" });
    expect(claudeCall(log, "toolu_elsewhere")).toBeNull();
    // a subagent's call is logged apart, and still names the conversation it works for
    const sub = entry("toolu_c", "2026-10-20T10:00:01.000Z", "claude-haiku-5-5", "low", "s-1", "a597");
    expect(claudeCall(sub, "toolu_c")?.session).toBe("s-1");
  });

  it("tells a conversation only of the harnesses it can, and guesses none", () => {
    expect(harnessOfClient(HARNESSES, "claude-code")?.id).toBe("claude-code");
    expect(harnessOfClient(HARNESSES, "codex-mcp-client")?.id).toBe("codex");
    expect(harnessOfClient(HARNESSES, "cursor")).toBeUndefined();
    expect(codexCall({ threadId: "th-only" })).toEqual({ turn: {}, thread: "th-only" });
  });

  it("names it for a person: harness, model, effort", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelName("gpt-6.1-sol")).toBe("GPT-6.1-sol");
    expect(agentLabel("Claude Code", { model: "claude-opus-5-5", effort: "high" })).toBe("Claude Code (Opus 5.5, high effort)");
    expect(agentLabel("Codex", { model: "gpt-6.1-sol" })).toBe("Codex (GPT-6.1-sol)");
    expect(agentLabel("Codex", null)).toBe("Codex");
  });

  it("outside a tool call nobody is acting for the person", async () => {
    expect(await Effect.runPromise(acting)).toBeUndefined();
  });

  // the attribution rests on the MCP server handing the connection's
  // clientInfo to a tool's handler; an upgrade that stops doing so would
  // silently file every act as the person's own
  it("a tool called over MCP knows the harness that called it, and its conversation", async () => {
    const Who = Tool.make("who", { success: Schema.String });
    const kit = Toolkit.make(Who);
    const handlers = kit.toLayer({ who: () => acting.pipe(Effect.map((caller) => (caller ? JSON.stringify(caller) : "nobody"))) });
    let port = 0;
    const announce = Layer.effectDiscard(
      Effect.gen(function* () {
        const addr = (yield* HttpServer.HttpServer).address;
        if (addr._tag === "InetAddressV4" || addr._tag === "InetAddressV6") port = addr.port;
      }),
    );
    const server = HttpRouter.serve(
      Layer.mergeAll(McpServer.toolkit(kit).pipe(Layer.provide(handlers)), announce).pipe(
        Layer.provideMerge(McpServer.layerHttp({ name: "t", version: "0", path: "/mcp", protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26] })),
      ),
      { disableListenLog: true },
    ).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 0, host: "127.0.0.1" })));

    const answer = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(server);
          const url = `http://127.0.0.1:${port}/mcp`;
          const post = (body: unknown, session?: string) =>
            Effect.promise(() =>
              fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", ...(session ? { "mcp-session-id": session } : {}) },
                body: JSON.stringify(body),
              }),
            );
          const init = yield* post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "codex-mcp-client", title: "Codex", version: "1" } } });
          const session = init.headers.get("mcp-session-id") ?? undefined;
          yield* Effect.promise(() => init.text());
          yield* post({ jsonrpc: "2.0", method: "notifications/initialized" }, session).pipe(Effect.flatMap((response) => Effect.promise(() => response.text())));
          // as Codex sends it: its thread, and the turn's model and effort
          const meta = { threadId: "th-9", "x-codex-turn-metadata": { turn_id: "tu", model: "gpt-6.1-sol", reasoning_effort: "medium" } };
          const call = yield* post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "who", arguments: {}, _meta: meta } }, session);
          return yield* Effect.promise(() => call.text());
        }),
      ),
    );
    expect(answer).toContain("Codex (GPT-6.1-sol, medium effort)");
    expect(answer).toContain('\\"conversation\\":{\\"ai\\":\\"codex\\",\\"id\\":\\"th-9\\"}');
    expect(answer).not.toContain("nobody");
  });
});
