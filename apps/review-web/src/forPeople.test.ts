import { describe, expect, it } from "vitest";
import { forPeople, wordsOf } from "./forPeople";

// as an AI drafted one on a real review: a code, a title, a dense paragraph, a suggestion
const drafted = [
  "[P2] Bound the author width so the event title remains visible",
  "",
  "The author now uses `noWrap` with `flexShrink: 0`, so it consumes its entire intrinsic width. Add a focused narrow-screen Storybook scenario, following the testing skill.",
  "",
  "```suggestion",
  "            sx={{ ml: 'auto', minWidth: 0, maxWidth: '50%' }}",
  "```",
].join("\n");

// what a person reads of it
const short = "Bound the author width so the event title remains visible\n\n```suggestion\n            sx={{ ml: 'auto', minWidth: 0, maxWidth: '50%' }}\n```";

describe("a comment is read by a person first", () => {
  it("a person reads an AI's title without its code, with the change it suggests; the whole stays beside it", () => {
    expect(forPeople(drafted)).toEqual({ body: short, detail: drafted });
  });

  it("a coded line alone loses its code, a bold one its marks too", () => {
    expect(forPeople("[P3] Rename it")).toEqual({ body: "Rename it" });
    expect(forPeople("**[P1] Guard the token**\n\nIt leaks in logs.")).toEqual({ body: "Guard the token", detail: "**[P1] Guard the token**\n\nIt leaks in logs." });
  });

  it("words with no code are a person's already, kept as written", () => {
    expect(forPeople("Why map to strings here?\n\nRows would keep the shape.")).toEqual({ body: "Why map to strings here?\n\nRows would keep the shape." });
    expect(forPeople("nit: see [P2] above")).toEqual({ body: "nit: see [P2] above" });
  });

  it("a comment with its detail kept shows its words as they are; one from before is read for people", () => {
    expect(wordsOf({ body: "Bound the author width", detail: drafted })).toEqual({ body: "Bound the author width", detail: drafted });
    expect(wordsOf({ body: drafted })).toEqual({ body: short, detail: drafted });
  });
});
