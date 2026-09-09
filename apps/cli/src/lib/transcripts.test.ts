import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pack, sessionDirs, sessionFile, sliceSince, unpack } from "./transcripts";

const tmp = () => mkdtempSync(join(tmpdir(), "collagen-transcripts-"));

describe("sessionDirs", () => {
  it("honours the CLIs' own overrides, else the home defaults", () => {
    expect(sessionDirs({ CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/x" }, "/home/u")).toEqual({ claude: "/c", codex: "/x" });
    expect(sessionDirs({}, "/home/u")).toEqual({ claude: "/home/u/.claude", codex: "/home/u/.codex" });
  });
});

describe("sessionFile", () => {
  it("finds a Claude Code session in any project dir", () => {
    const claude = tmp();
    mkdirSync(join(claude, "projects", "-Users-me-proj"), { recursive: true });
    writeFileSync(join(claude, "projects", "-Users-me-proj", "11111111-2222-3333-4444-555555555555.jsonl"), "{}\n");
    const dirs = { claude, codex: "/nowhere" };
    expect(sessionFile("claude-code", "11111111-2222-3333-4444-555555555555", dirs)).toBe(join(claude, "projects", "-Users-me-proj", "11111111-2222-3333-4444-555555555555.jsonl"));
    expect(sessionFile("claude-code", "99999999-2222-3333-4444-555555555555", dirs)).toBeNull();
  });

  it("finds a Codex rollout by thread id under the dated tree", () => {
    const codex = tmp();
    const day = join(codex, "sessions", "2026", "09", "09");
    mkdirSync(day, { recursive: true });
    const f = join(day, "rollout-2026-09-09T10-00-00-019c0000-0000-7000-8000-000000000abc.jsonl");
    writeFileSync(f, "{}\n");
    const dirs = { claude: "/nowhere", codex };
    expect(sessionFile("codex", "019c0000-0000-7000-8000-000000000abc", dirs)).toBe(f);
    expect(sessionFile("codex", "019c0000-0000-7000-8000-000000000def", dirs)).toBeNull();
  });

  it("refuses ids that could escape or match everything", () => {
    const dirs = { claude: "/nowhere", codex: "/nowhere" };
    expect(sessionFile("codex", "../x", dirs)).toBeNull();
    expect(sessionFile("codex", "ab", dirs)).toBeNull();
    expect(sessionFile("mock:codex", "11111111-2222-3333-4444-555555555555", dirs)).toBeNull();
  });
});

describe("sliceSince", () => {
  const jsonl = [
    JSON.stringify({ type: "session_meta", timestamp: "2026-09-01T08:00:00.000Z", payload: { id: "t" } }),
    JSON.stringify({ timestamp: "2026-09-01T09:00:00.000Z", type: "response_item", text: "unrelated morning work" }),
    "not json at all",
    JSON.stringify({ type: "no-stamp", text: "keep me, I belong to my neighbours" }),
    JSON.stringify({ timestamp: "2026-09-01T12:00:00.000Z", type: "response_item", text: "collagen nudge arrives" }),
    JSON.stringify({ timestamp: "2026-09-01T12:01:00.000Z", type: "response_item", text: "the person answers" }),
  ].join("\n");

  it("keeps meta and un-stamped lines, drops what predates the adoption, counts the rest", () => {
    const { lines, entries } = sliceSince(jsonl, Date.parse("2026-09-01T11:00:00.000Z"));
    expect(entries).toBe(2);
    expect(lines.map((l) => (JSON.parse(l) as { type?: string; text?: string }).text ?? "meta")).toEqual([
      "meta",
      "keep me, I belong to my neighbours",
      "collagen nudge arrives",
      "the person answers",
    ]);
  });

  it("round-trips through the wire form", () => {
    const { lines } = sliceSince(jsonl, 0);
    expect(unpack(pack(lines)).trim().split("\n")).toEqual([...lines]);
  });
});
