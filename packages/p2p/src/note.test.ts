import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { appliesTo, noteNow, NoteTurn, SteeringNote } from "./note";

const note: SteeringNote = {
  id: "n1",
  project: "collagen",
  title: "Measure alignment",
  description: "Things that sit together share an edge; measure it before calling it done. Said every time a screen was built.",
  by: "alice",
  byName: "Alice",
  at: 100,
};

// three people at once: bob changes the line having seen nothing, carol
// retires it having seen nothing, then alice, having seen both, restores it
const bob: NoteTurn = { id: "t-b", note: "n1", kind: "change", reason: "shorter", change: { description: "Share edges, measured." }, knows: [], by: "bob", byName: "Bob", at: 300 };
const carol: NoteTurn = { id: "t-c", note: "n1", kind: "retire", reason: "the page does it now", knows: [], by: "carol", byName: "Carol", at: 200 };
const alice: NoteTurn = { id: "t-a", note: "n1", kind: "restore", reason: "it does not, yet", knows: ["t-b", "t-c"], by: "alice", byName: "Alice", at: 150 };

const permutations = <A,>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  items.length <= 1 ? [items] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));

describe("a steering note", () => {
  it("is the same on every peer, however its turns arrived", () => {
    const seen = permutations([bob, carol, alice]).map((order) => {
      const now = noteNow(note, order);
      return JSON.stringify({ words: now.words, retired: now.retired, writers: [...now.writers].sort(), turns: now.turns.map((turn) => turn.id) });
    });
    expect(new Set(seen).size).toBe(1);
  });

  it("follows what the writer had seen, not the clock", () => {
    // alice's clock is behind, but she restored it after seeing the retire
    const now = noteNow(note, [bob, carol, alice]);
    expect(now.retired).toBe(false);
    expect(now.words.description).toBe("Share edges, measured.");
    expect(now.turns.at(-1)?.id).toBe("t-a");
  });

  it("stays unread while only an AI on its own has written to it", () => {
    const byAi = { ...note, unread: true };
    expect(noteNow(byAi, []).read).toBe(false);
    expect(noteNow(byAi, [{ ...bob, unread: true }]).read).toBe(false);
    expect(noteNow(byAi, [{ ...bob, kind: "keep" }]).read).toBe(true);
  });

  it("decodes as first written, with none of what it may grow", () => {
    expect(Schema.decodeUnknownSync(SteeringNote)({ id: "n", project: "p", title: "t", description: "d", by: "k", byName: "K", at: 1 })).toMatchObject({ id: "n" });
  });

  it("applies where it says", () => {
    expect(appliesTo(undefined, "apps/cli/src/a.ts")).toBe(true);
    expect(appliesTo(["apps/review-web/**"], "apps/review-web/src/components/Chat.tsx")).toBe(true);
    expect(appliesTo(["apps/review-web/**"], "apps/cli/src/a.ts")).toBe(false);
    expect(appliesTo(["*.tsx"], "apps/review-web/src/components/Chat.tsx")).toBe(true);
    expect(appliesTo(["apps/cli"], "apps/cli/src/a.ts")).toBe(true);
  });
});
