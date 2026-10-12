import { describe, expect, it } from "vitest";
import { Option } from "effect";
import type { ChatTurn } from "@collagen/review-web/data";
import { claudeChat, codexChat, type ChatEvent } from "./ChatAdapters";
import { applyEvents, promptFor } from "./ReviewChat";

const lines = (...objects: ReadonlyArray<unknown>) => objects.map((object) => JSON.stringify(object));
const read = (adapter: typeof claudeChat, stdout: ReadonlyArray<string>): ReadonlyArray<ChatEvent> => stdout.flatMap(adapter.read);
const turn: ChatTurn = { id: "t", question: "q", selection: null, commit: null, answer: "", doing: null, state: "answering" };

describe("claudeChat", () => {
  it("resumes the conversation and asks for a stream of what it writes, read-only", () => {
    const args = claudeChat.args({ cwd: "/r", prompt: "hi", sessionId: Option.some("s1"), mcpUrl: "http://127.0.0.1:1/mcp", serverName: "collagen-alice" });
    expect(args.slice(0, 2)).toEqual(["--resume", "s1"]);
    expect(args).toContain("stream-json");
    expect(args).toContain("--include-partial-messages");
    const tools = args[args.indexOf("--allowedTools") + 1]!;
    expect(tools).toContain("mcp__collagen-alice__review-context");
    expect(tools).not.toMatch(/Edit|Write|mcp__collagen-alice__\*/);
  });

  it("reads its session, text as it streams, what it does between, and its final answer", () => {
    const events = read(
      claudeChat,
      lines(
        { type: "system", subtype: "init", session_id: "s1" },
        { type: "stream_event", event: { type: "content_block_start", content_block: { type: "text", text: "" } } },
        { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Let me look." } } },
        { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } }] } },
        { type: "stream_event", event: { type: "content_block_start", content_block: { type: "text", text: "" } } },
        { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "It maps" } } },
        { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: " rows." } } },
      ),
    );
    const blocks: Array<string> = [];
    const mid = applyEvents(turn, blocks, events);
    expect(mid.answer).toBe("Let me look.\n\nIt maps rows.");
    const done = applyEvents(mid, blocks, read(claudeChat, lines({ type: "result", subtype: "success", is_error: false, result: "It maps rows.", session_id: "s1" })));
    expect(done.answer).toBe("It maps rows.");
    expect(events).toContainEqual({ kind: "doing", what: "Read src/a.ts" });
    expect(events[0]).toEqual({ kind: "session", id: "s1" });
  });

  it("says why it failed, and ignores what is not its JSON", () => {
    expect(read(claudeChat, ["warning: something", ...lines({ type: "result", subtype: "error_max_turns", is_error: true, session_id: "s1" })])).toEqual([
      { kind: "session", id: "s1" },
      { kind: "failed", error: "error_max_turns" },
    ]);
  });
});

describe("codexChat", () => {
  it("reads its thread, each message whole, and the commands it runs", () => {
    const events = read(
      codexChat,
      lines(
        { type: "thread.started", thread_id: "th1" },
        { type: "item.started", item: { type: "command_execution", command: "git show abc:src/a.ts" } },
        { type: "item.completed", item: { type: "agent_message", text: "It maps rows." } },
      ),
    );
    expect(events).toEqual([
      { kind: "session", id: "th1" },
      { kind: "doing", what: "git show abc:src/a.ts" },
      { kind: "text", text: "It maps rows.", block: true },
    ]);
    expect(read(codexChat, lines({ type: "turn.failed", error: { message: "no auth" } }))).toEqual([{ kind: "failed", error: "no auth" }]);
  });

  it("resumes with exec resume, read-only", () => {
    const args = codexChat.args({ cwd: "/r", prompt: "hi", sessionId: Option.some("th1"), mcpUrl: "", serverName: "collagen" });
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "th1"]);
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args.join(" ")).not.toContain("default_tools_approval_mode");
  });
});

describe("promptFor", () => {
  it("opens a new conversation, and on a follow-up names the commit the page moved to", () => {
    expect(promptFor({ opening: "You read a review.", moved: null, now: "Their question: q" })).toBe("You read a review.\n\nTheir question: q");
    expect(promptFor({ opening: null, moved: null, now: "Their question: q" })).toBe("Their question: q");
    expect(promptFor({ opening: null, moved: "abc123", now: "Their question: q" })).toContain("git show abc123:<path>");
  });
});
