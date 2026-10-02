import { describe, expect, it } from "vitest";
import { frame, readFrames } from "./lsp";

describe("LSP framing", () => {
  it("reads what it writes, several messages in one chunk", () => {
    const both = Buffer.concat([frame({ id: 1, result: "a" }), frame({ id: 2, result: "ø — multibyte" })]);
    const { messages, rest } = readFrames(both);
    expect(messages).toEqual([{ id: 1, result: "a" }, { id: 2, result: "ø — multibyte" }]);
    expect(rest.length).toBe(0);
  });

  it("keeps a message split across chunks until it is whole", () => {
    const one = frame({ id: 7, result: { contents: "x" } });
    const first = readFrames(one.subarray(0, 25));
    expect(first.messages).toEqual([]);
    const second = readFrames(Buffer.concat([first.rest, one.subarray(25)]));
    expect(second.messages).toEqual([{ id: 7, result: { contents: "x" } }]);
  });

  it("Content-Length counts bytes, not characters", () => {
    expect(frame({ s: "é" }).toString("ascii").startsWith("Content-Length: 10\r\n")).toBe(true);
  });
});
