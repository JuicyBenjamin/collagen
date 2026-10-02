import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DefinitionResult } from "./data";

// the page module reads its ticket from the url and listens for Esc
const answers: Array<DefinitionResult> = [];
const fetch = vi.fn(async () => new Response(JSON.stringify(answers.shift() ?? { peeks: [] }), { status: 200 }));
let intel: typeof import("./intel");
beforeAll(async () => {
  Object.assign(globalThis, { location: { pathname: "/review/t1" }, addEventListener: () => {}, fetch });
  intel = await import("./intel");
});
const settle = () => new Promise((r) => setTimeout(r, 0));
const spot = { file: "src/A.php", line: 3, col: 4 };

describe("a peek that was not a final answer", () => {
  it("a click on the same word asks again instead of closing; a final answer then closes on the next", async () => {
    answers.push({ indexing: true }, { peeks: [], partial: true }, { peeks: [] });
    intel.peekAt("h1", 0, spot);
    await settle();
    expect(intel.peek()?.result).toEqual({ indexing: true });
    intel.peekAt("h1", 0, spot); // the retry the note asks for
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(intel.peek()?.result).toEqual({ peeks: [], partial: true });
    intel.retryPeek(); // its Try again
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(intel.peek()?.result).toEqual({ peeks: [] });
    intel.peekAt("h1", 0, spot); // a final answer: the same click folds it away
    expect(intel.peek()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
