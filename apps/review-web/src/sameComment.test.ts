import { describe, expect, it } from "vitest";
import type { LineComment } from "./data";
import { onceEach, type RoomComment } from "./sameComment";

const onHost = (id: string, body: string, line = 78): LineComment => ({
  id,
  author: { login: "JuicyBenjamin" },
  body,
  file: "src/card.tsx",
  line,
  side: "RIGHT",
  url: `https://github.com/acme/app/pull/7#discussion_r${id}`,
  at: "2026-10-20T10:00:00Z",
});

const inRoom = (id: string, body: string, extra: Partial<RoomComment> = {}): RoomComment => ({
  id,
  author: { login: "Juicy" },
  body,
  file: "src/card.tsx",
  line: 78,
  side: "RIGHT",
  url: "",
  at: "2026-10-20T10:00:00Z",
  ...extra,
});

const shown = (comments: ReadonlyArray<LineComment>) => comments.map((comment) => `${comment.id}${comment.drafted ? " with AI" : ""}`);

describe("a comment said in the room and on the host", () => {
  it("shows once, as the host's, when the room names its copy there", () => {
    expect(shown(onceEach([onHost("4301", "Bound the author width")], [inRoom("a", "Bound the author width", { hostId: "4301", drafted: true })]))).toEqual(["4301 with AI"]);
  });

  it("shows once when the room's copy names none, matched by its lines and words", () => {
    const hosted = onHost("4301", "Bound the author width\r\nso the title shows  \n");
    expect(shown(onceEach([hosted], [inRoom("a", "Bound the author width\nso the title shows", { drafted: true })]))).toEqual(["4301 with AI"]);
  });

  it("a block of lines is matched by where it starts too", () => {
    const block = { ...onHost("4301", "Same words"), startLine: 70, startSide: "RIGHT" as const };
    expect(shown(onceEach([block], [inRoom("a", "Same words", { startLine: 70, startSide: "RIGHT" })]))).toEqual(["4301"]);
    expect(shown(onceEach([block], [inRoom("a", "Same words", { startLine: 72, startSide: "RIGHT" })]))).toEqual(["4301", "a"]);
  });

  it("each host comment stands for one room comment: the same words said twice in the room show twice", () => {
    expect(shown(onceEach([onHost("4301", "Rename it")], [inRoom("a", "Rename it"), inRoom("b", "Rename it")]))).toEqual(["4301", "b"]);
  });

  it("a match by words never takes the copy another room comment names", () => {
    expect(shown(onceEach([onHost("4301", "Rename it")], [inRoom("a", "Rename it"), inRoom("b", "Rename it", { hostId: "4301" })]))).toEqual(["4301", "a"]);
  });

  it("other words, other lines, or a copy gone from the host: the room's shows on its own", () => {
    expect(shown(onceEach([onHost("4301", "Rename it")], [inRoom("a", "Rename it, please")]))).toEqual(["4301", "a"]);
    expect(shown(onceEach([onHost("4301", "Rename it", 79)], [inRoom("a", "Rename it")]))).toEqual(["4301", "a"]);
    expect(shown(onceEach([onHost("4301", "Rename it")], [inRoom("a", "Rename it", { hostId: "9999" })]))).toEqual(["4301", "a"]);
  });

  it("before the host is read, the room's comments show", () => {
    expect(shown(onceEach([], [inRoom("a", "Rename it", { hostId: "4301" })]))).toEqual(["a"]);
  });
});
