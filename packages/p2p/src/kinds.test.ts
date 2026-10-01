import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KIND_ORDER, KINDS } from "./kinds";
import { TicketKind } from "./ticket";

describe("kinds", () => {
  it("the lifecycle order names every kind exactly once", () => {
    expect([...KIND_ORDER].sort()).toEqual([...TicketKind.literals].sort());
  });

  // the guide's "kinds at a glance" table is the person's lines, word for
  // word: change a line here and the guide must follow, or this fails
  it("the tickets guide carries the same lines the TUI shows", () => {
    const guide = readFileSync(fileURLToPath(new URL("../../../apps/docs/guide/tickets.md", import.meta.url)), "utf8");
    for (const kind of KIND_ORDER) {
      const k = KINDS[kind];
      expect(guide).toContain(`| \`${kind}\` | ${k.what} | ${k.asks} | ${k.closes} |`);
    }
  });
});
