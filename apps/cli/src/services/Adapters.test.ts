import { describe, expect, it } from "vitest";
import { Option } from "effect";
import type { RoomMessage } from "@collagen/p2p";
import { claudeAdapter, codexAdapter, nudgePrompt, type SpawnCtx } from "./Adapters";

const msg: RoomMessage = {
  id: "m1",
  threadId: "thread-1",
  from: "aa".repeat(32),
  fromName: "alice",
  project: "sandbox",
  intent: "question",
  findings: "why does average() skip the first element?",
  ts: 1,
};

const ctx = (sessionId: Option.Option<string> = Option.none()): SpawnCtx => ({
  cwd: "/tmp/sandbox",
  mcpUrl: "http://127.0.0.1:44040/mcp",
  serverName: "collagen-alice",
  msg,
  sessionId,
});

describe("nudgePrompt", () => {
  it("names the sender, project, intent, and threadId", () => {
    const p = nudgePrompt(ctx());
    expect(p).toContain("alice");
    expect(p).toContain('"sandbox"');
    expect(p).toContain("question");
    expect(p).toContain('threadId "thread-1"');
    expect(p).toContain("collagen-alice");
  });

  it("says new conversation vs new message depending on session", () => {
    expect(nudgePrompt(ctx())).toContain("a new conversation was started");
    expect(nudgePrompt(ctx(Option.some("s1")))).toContain("a new message arrived");
  });
});

describe("claude adapter", () => {
  it("fresh run: -p prompt, inline strict MCP config, json output", () => {
    const args = claudeAdapter.args(ctx());
    expect(args[0]).toBe("-p");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--output-format");
    const mcpIdx = args.indexOf("--mcp-config");
    const mcp = JSON.parse(args[mcpIdx + 1]!);
    expect(mcp.mcpServers["collagen-alice"]).toEqual({
      type: "http",
      url: "http://127.0.0.1:44040/mcp",
    });
    expect(args).not.toContain("--resume");
  });

  it("resume run: --resume <id> prefixed", () => {
    const args = claudeAdapter.args(ctx(Option.some("sess-42")));
    expect(args.slice(0, 2)).toEqual(["--resume", "sess-42"]);
  });

  it("parse: extracts session_id and result; garbage → empty", () => {
    expect(claudeAdapter.parse(JSON.stringify({ session_id: "s", result: "r" }))).toEqual({
      sessionId: "s",
      result: "r",
    });
    expect(claudeAdapter.parse("not json")).toEqual({});
  });
});

describe("codex adapter", () => {
  it("fresh run: exec + json + read-only sandbox via -c (no --sandbox flag)", () => {
    const args = codexAdapter.args(ctx());
    expect(args[0]).toBe("exec");
    expect(args).toContain("--json");
    // codex ≥0.152: `exec resume` rejects --sandbox, so both paths use -c
    expect(args).not.toContain("--sandbox");
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args.at(-1)).toBe(nudgePrompt(ctx()));
  });

  it("resume run: exec resume <id> then flags then prompt", () => {
    const args = codexAdapter.args(ctx(Option.some("thread-abc")));
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "thread-abc"]);
    expect(args).not.toContain("--sandbox");
    expect(args.at(-1)).toBe(nudgePrompt(ctx(Option.some("thread-abc"))));
  });

  it("parse: scans JSONL for thread id and final agent message, skipping noise", () => {
    const out = [
      "Reading additional input from stdin...",
      JSON.stringify({ type: "thread.started", thread_id: "t-9" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "found the bug" } }),
    ].join("\n");
    expect(codexAdapter.parse(out)).toEqual({ sessionId: "t-9", result: "found the bug" });
  });

  it("parse: no events → empty", () => {
    expect(codexAdapter.parse("")).toEqual({ sessionId: undefined, result: undefined });
  });
});
