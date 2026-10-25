import { describe, expect, it } from "vitest";
import { Option } from "effect";
import type { RoomMessage } from "@collagen/p2p";
import { mockAdapter, wakeLine, type SpawnCtx } from "./Adapters";

const message: RoomMessage = {
  id: "m1",
  threadId: "thread-1",
  to: "bb".repeat(32),
  from: "aa".repeat(32),
  fromName: "alice",
  project: "sandbox",
  intent: "question",
  findings: "why does average() skip the first element?",
  ts: 1,
};

const spawnContext = (sessionId: Option.Option<string> = Option.none()): SpawnCtx => ({
  cwd: "/tmp/sandbox",
  mcpUrl: "http://127.0.0.1:44040/mcp",
  serverName: "collagen-alice",
  message,
  sessionId,
});

describe("wakeLine", () => {
  it("names the sender, project, intent, and threadId", () => {
    const prompt = wakeLine(spawnContext());
    expect(prompt).toContain("alice");
    expect(prompt).toContain('"sandbox"');
    expect(prompt).toContain("question");
    expect(prompt).toContain('threadId "thread-1"');
    expect(prompt).toContain("collagen-alice");
  });

  it("says new conversation vs new message depending on session", () => {
    expect(wakeLine(spawnContext())).toContain("a new conversation was started");
    expect(wakeLine(spawnContext(Option.some("s1")))).toContain("a new message arrived");
  });
});

describe("mockAdapter", () => {
  it("spawns node on the mock-agent script with the message context", () => {
    const args = mockAdapter.args(spawnContext());
    expect(mockAdapter.cmd).toBe(process.execPath);
    expect(args[0]).toMatch(/mock-agent\.mjs$/);
    expect(args.slice(1)).toEqual([
      "http://127.0.0.1:44040/mcp",
      "thread-1",
      "alice",
      "sandbox",
      "question",
      "fresh",
    ]);
  });

  it("passes the stored session id through — it carries the thread's ack count", () => {
    expect(mockAdapter.args(spawnContext(Option.some("mock#2"))).at(-1)).toBe("mock#2");
  });

  it("parse: claude-shaped single JSON object", () => {
    expect(mockAdapter.parse('{"session_id":"mock-thread-1","result":"mock agent: read thread"}\n')).toEqual({
      sessionId: "mock-thread-1",
      result: "mock agent: read thread",
    });
    expect(mockAdapter.parse("garbage")).toEqual({});
  });

  it("auth: logged in iff node exits 0", () => {
    expect(mockAdapter.auth.loggedIn("v26.8.1", 0)).toBe(true);
    expect(mockAdapter.auth.loggedIn("", 1)).toBe(false);
  });
});
