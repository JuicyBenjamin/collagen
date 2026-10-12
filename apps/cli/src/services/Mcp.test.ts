import { Tool } from "effect/ai";
import { describe, expect, it } from "vitest";
import { CollagenToolkit, DevCollagenToolkit } from "./Mcp";

// One tool the MCP server will not register stops the whole server: no
// agent can reach collagen, and the review page and the rooms look empty.
describe("collagen's tools", () => {
  it("every one registers with the MCP server: its parameters an object schema", () => {
    for (const toolkit of [CollagenToolkit, DevCollagenToolkit]) {
      for (const [name, tool] of Object.entries(toolkit.tools)) {
        expect({ name, type: Tool.getJsonSchema(tool as Tool.Any).type }).toEqual({ name, type: "object" });
      }
    }
  });
});
