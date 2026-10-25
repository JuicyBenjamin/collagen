import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readUsage as readClaude } from "../services/harnesses/claudeCode/usage";
import { readUsage as readCodex } from "../services/harnesses/codex/usage";
import { byTool, callsOn, collagenTool, readSessions } from "./tokenCost";
import { claudeCode } from "../services/harnesses/claudeCode";
import { codex } from "../services/harnesses/codex";

const HARNESSES = [claudeCode, codex];

const jsonl = (...lines: ReadonlyArray<unknown>) => lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
const TICKET = "f69d867e-3183-4a4a-9295-0abbec344ddd";

describe("collagenTool — which calls are collagen's", () => {
  it("reads every server name collagen registers as, and nothing else", () => {
    expect(collagenTool("mcp__collagen__get-tickets")).toBe("get-tickets");
    expect(collagenTool("mcp__collagen-devnet-alice__post-review")).toBe("post-review");
    expect(collagenTool("collagen__propose")).toBe("propose");
    expect(collagenTool("collagen.get-messages")).toBe("get-messages");
    expect(collagenTool("get-tickets", "collagen")).toBe("get-tickets");
    expect(collagenTool("mcp__claude-in-chrome__computer")).toBeNull();
    expect(collagenTool("Bash")).toBeNull();
    expect(collagenTool("shell")).toBeNull();
  });
});

const claudeReply = (id: string, window: number, content: ReadonlyArray<unknown> = []) => ({
  type: "assistant",
  timestamp: "2026-10-01T10:00:00Z",
  message: { id, role: "assistant", content, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: window - 10, output_tokens: 5 } },
});
const claudeResult = (id: string, text: string) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } });

describe("readClaude", () => {
  it("pairs collagen calls with their results, counts each reply once, and charges collagen for every reply its result stays in", () => {
    const session = readClaude(
      jsonl(
        claudeReply("m1", 1000, [{ type: "tool_use", id: "a", name: "mcp__collagen__review-context", input: { ticketId: TICKET } }]),
        // the same reply split over two lines repeats its usage
        claudeReply("m1", 1000, [{ type: "tool_use", id: "b", name: "Bash", input: { command: "ls" } }]),
        claudeResult("a", "x".repeat(400)),
        claudeResult("b", "y".repeat(4000)),
        claudeReply("m2", 1200),
        claudeReply("m3", 1300),
      ),
    );
    expect(session.calls).toEqual([{ tool: "review-context", kind: "review", argChars: JSON.stringify({ ticketId: TICKET }).length, resultChars: 400, text: JSON.stringify({ ticketId: TICKET }) }]);
    expect(session.replies).toBe(3);
    expect(session.inputTokens).toBe(3500);
    expect(session.outputTokens).toBe(15);
    const inWindow = Math.round((JSON.stringify({ ticketId: TICKET }).length + 400) / 4);
    expect(session.collagenInputTokens).toBe(2 * inWindow); // m2 and m3, not m1 (before the result)
    expect(session.peakWindow).toBe(1300);
  });

  it("a compaction the AI did on its own is a break, with what collagen put in before it; one the person asked for is not", () => {
    const session = readClaude(
      jsonl(
        claudeReply("m1", 1000, [{ type: "tool_use", id: "a", name: "mcp__collagen__get-tickets", input: {} }]),
        claudeResult("a", "z".repeat(800)),
        claudeReply("m2", 1900),
        { type: "system", subtype: "compact_boundary", timestamp: "t1", compactMetadata: { trigger: "auto", preTokens: 190000 } },
        claudeReply("m3", 300),
        { type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "manual", preTokens: 500 } },
        claudeReply("m4", 200),
        { type: "assistant", isApiErrorMessage: true, message: { id: "e", content: [{ type: "text", text: "Prompt is too long" }] } },
      ),
    );
    expect(session.breaks).toEqual([
      { at: "t1", how: "compacted", windowBefore: 190000, collagenCalls: 1, collagenChars: 802, largest: { tool: "get-tickets", chars: 800 }, ticketsTouched: 0 },
      { at: null, how: "overflow", windowBefore: 200, collagenCalls: 0, collagenChars: 0, largest: null, ticketsTouched: 0 },
    ]);
    // after the break, nothing of collagen's is in the window
    expect(session.collagenInputTokens).toBe(Math.round(802 / 4));
  });
});

const tokenCount = (input: number, total: number, window = 258400) => ({
  type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, output_tokens: 7, reasoning_output_tokens: 3 }, model_context_window: window } },
});

describe("readCodex", () => {
  it("reads calls by call id, a step's usage once however often it is reported, and the model's window", () => {
    const session = readCodex(
      jsonl(
        { type: "response_item", payload: { type: "function_call", name: "mcp__collagen__propose", arguments: `{"title":"t"}`, call_id: "c1" } },
        { type: "event_msg", payload: { type: "mcp_tool_call_end", call_id: "c1", invocation: { server: "collagen", tool: "propose", arguments: {} }, result: { Ok: { content: [{ type: "text", text: TICKET }] } } } },
        { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: `filed ${TICKET}` } },
        tokenCount(5000, 5010),
        tokenCount(5000, 5010),
        tokenCount(6000, 11020),
      ),
    );
    expect(session.calls.map((call) => [call.tool, call.kind, call.argChars, call.resultChars])).toEqual([["propose", "filing", 13, 6 + TICKET.length]]);
    expect(session.replies).toBe(2);
    expect(session.inputTokens).toBe(11000);
    expect(session.outputTokens).toBe(20);
    expect(session.contextWindow).toBe(258400);
    expect(callsOn(session.calls, TICKET)).toHaveLength(1); // a filing call is on the ticket it filed
  });

  it("older logs with only MCP events still count; a compaction logged twice is one break", () => {
    const session = readCodex(
      jsonl(
        { type: "event_msg", payload: { type: "mcp_tool_call_end", call_id: "c1", invocation: { server: "collagen-devnet", tool: "get-tickets", arguments: {} }, result: { Ok: { content: [{ type: "text", text: "abc" }] } } } },
        tokenCount(250000, 250010),
        { type: "compacted", timestamp: "t2", payload: { message: "summary" } },
        { type: "event_msg", payload: { type: "context_compacted" } },
      ),
    );
    expect(session.calls.map((call) => [call.tool, call.resultChars])).toEqual([["get-tickets", 3]]);
    expect(session.breaks).toHaveLength(1);
    expect(session.breaks[0]).toMatchObject({ at: "t2", how: "compacted", windowBefore: 250000, collagenCalls: 1 });
  });
});

describe("byTool and callsOn", () => {
  it("ranks tools by what they carried; a ticket is named by its id or its short id, in what was passed", () => {
    const calls = [
      { tool: "get-tickets", kind: "tickets", argChars: 2, resultChars: 9000, text: "{}" },
      { tool: "post-review", kind: "review", argChars: 300, resultChars: 20, text: `{"ticketId":"${TICKET.slice(0, 8)}"}` },
      { tool: "post-review", kind: "review", argChars: 100, resultChars: 30, text: "{}" },
    ] as const;
    expect(byTool(calls).map((total) => [total.tool, total.calls, total.largestResult])).toEqual([
      ["get-tickets", 1, 9000],
      ["post-review", 2, 30],
    ]);
    expect(callsOn(calls, TICKET)).toEqual([calls[1]]);
  });
});

describe("readSessions", () => {
  it("finds the sessions that called collagen, sub-agents' included, and skips the rest", async () => {
    const claude = mkdtempSync(join(tmpdir(), "collagen-cost-"));
    const project = join(claude, "projects", "-Users-me-proj");
    mkdirSync(join(project, "s1", "subagents"), { recursive: true });
    const used = jsonl(claudeReply("m1", 100, [{ type: "tool_use", id: "a", name: "mcp__collagen__list-room", input: {} }]), claudeResult("a", "room"));
    writeFileSync(join(project, "s1.jsonl"), used);
    writeFileSync(join(project, "s1", "subagents", "agent-1.jsonl"), used);
    writeFileSync(join(project, "s2.jsonl"), jsonl(claudeReply("m1", 100)));
    const found = await readSessions(HARNESSES, { "claude-code": claude, codex: "/nowhere" }, 0);
    expect(found.map((session) => session.file.replace(project, "")).sort()).toEqual(["/s1.jsonl", "/s1/subagents/agent-1.jsonl"]);
  });
});
