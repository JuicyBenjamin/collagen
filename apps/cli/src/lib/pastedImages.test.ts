import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCode } from "../services/harnesses/claudeCode";
import { codex } from "../services/harnesses/codex";
import { pastedImages } from "./pastedImages";

const png = (text: string) => Buffer.from(text).toString("base64");
const log = (records: ReadonlyArray<unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), "pasted-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n"));
  return { file, out: join(dir, "out") };
};

describe("pastedImages", () => {
  it("takes the images a person pasted in Claude Code, the latest last, never one a tool returned", () => {
    const { file, out } = log([
      { type: "user", message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png("first") } }, { type: "text", text: "look" }] } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png("from a tool") } }] }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I see it" }] } },
      { type: "user", message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/webp", data: png("second") } }, { type: "text", text: "New bug, comments are hidden:" }] } },
    ]);
    const files = pastedImages(claudeCode, file, 2, out);
    expect(files.map((path) => readFileSync(path, "utf8"))).toEqual(["first", "second"]);
    expect(files[1]).toMatch(/\.webp$/);
    expect(pastedImages(claudeCode, file, 1, out).map((path) => readFileSync(path, "utf8"))).toEqual(["second"]);
  });

  it("takes the images a person pasted in Codex, from their data URLs", () => {
    const { file, out } = log([
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "see" }, { type: "input_image", image_url: `data:image/jpeg;base64,${png("codex shot")}` }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } },
    ]);
    const files = pastedImages(codex, file, 3, out);
    expect(files.map((path) => readFileSync(path, "utf8"))).toEqual(["codex shot"]);
    expect(files[0]).toMatch(/\.jpg$/);
  });

  it("finds nothing in a conversation without images", () => {
    const { file, out } = log([{ type: "user", message: { role: "user", content: "just words" } }]);
    expect(pastedImages(claudeCode, file, 1, out)).toEqual([]);
  });
});
