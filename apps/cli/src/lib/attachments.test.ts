import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeFile, mimeOf, packBytes, safeName, unpackBytes } from "./attachments";

const tmp = () => mkdtempSync(join(tmpdir(), "collagen-attach-"));

describe("attachments", () => {
  it("bytes survive the wire packing", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
    expect(unpackBytes(packBytes(bytes))).toEqual(bytes);
  });

  it("types by extension, octet-stream when unknown", () => {
    expect(mimeOf("shot.PNG")).toBe("image/png");
    expect(mimeOf("notes.md")).toBe("text/markdown");
    expect(mimeOf("whatever.bin")).toBe("application/octet-stream");
  });

  it("describes a plain file, and a transcript by its meta file", () => {
    const dir = tmp();
    writeFileSync(join(dir, "shot.png"), Buffer.alloc(10));
    expect(describeFile(join(dir, "shot.png"))).toEqual({ file: join(dir, "shot.png"), name: "shot.png", bytes: 10, mime: "image/png" });
    const t = join(dir, "bob-0123456789abcdef.codex.jsonl");
    writeFileSync(t, "{}\n{}\n");
    writeFileSync(`${t}.meta.json`, JSON.stringify({ subject: "thread-0123456789abcdef", from: "bob", fromKey: "k", ai: "codex", threadId: "0123456789abcdef", sessionId: "s", since: 5, entries: 2, receivedAt: 9, requestId: "r" }));
    expect(describeFile(t)?.transcript).toEqual({ from: "bob", ai: "codex", threadId: "0123456789abcdef", sessionId: "s", entries: 2, since: 5, origin: "thread-0123456789abcdef" });
    mkdirSync(join(dir, "d"));
    expect(describeFile(join(dir, "d"))).toBeNull();
    expect(describeFile(join(dir, "missing"))).toBeNull();
  });

  it("filenames are made safe", () => {
    expect(safeName("my shot (1).png")).toBe("my_shot__1_.png");
  });
});
