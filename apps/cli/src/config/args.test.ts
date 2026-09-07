import { describe, expect, it } from "vitest";
import { stripArgSeparator } from "./args";

describe("stripArgSeparator", () => {
  it("removes the first bare -- (pnpm forwards it verbatim)", () => {
    expect(stripArgSeparator(["node", "src/index.tsx", "--", "--profile", "alice"])).toEqual([
      "node",
      "src/index.tsx",
      "--profile",
      "alice",
    ]);
  });

  it("passes argv without a separator through unchanged", () => {
    expect(stripArgSeparator(["node", "x", "--profile", "alice"])).toEqual(["node", "x", "--profile", "alice"]);
  });

  it("only strips the first separator", () => {
    expect(stripArgSeparator(["node", "x", "--", "a", "--", "b"])).toEqual(["node", "x", "a", "--", "b"]);
  });
});
