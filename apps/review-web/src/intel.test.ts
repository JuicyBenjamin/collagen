import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DefinitionResult, HoverResult } from "./data";

// the page module reads its ticket from the url and listens for Esc; the
// server functions it calls are compiled by the page's build, so here they
// are stand-ins answering from a queue
const answers: Array<DefinitionResult> = [];
const definitionAt = vi.fn(async () => answers.shift() ?? { peeks: [] });
const hoverAnswers: Array<() => Promise<HoverResult>> = [];
const hoverAt = vi.fn(() => (hoverAnswers.shift() ?? (async () => ({ none: true }) as HoverResult))());
// the page's diff is of a commit: what is asked is of that commit
vi.mock("./diffNow", () => ({ diffNow: { commit: () => "abc1234", addedIn: () => new Set(), canReadWhole: () => false, hunksOf: () => [] } }));
vi.mock("./api", () => ({ definitionAt, hoverAt, toolState: vi.fn(async () => null), installTool: vi.fn(async () => null) }));
let intel: typeof import("./intel");
beforeAll(async () => {
  Object.assign(globalThis, { location: { pathname: "/review/t1" }, addEventListener: () => {} });
  intel = await import("./intel");
});
const spot = { file: "src/A.php", line: 3, col: 4 };

describe("a peek given while the server was still reading", () => {
  it("is asked again by itself until whole; a failure waits for its Try again", async () => {
    vi.useFakeTimers();
    answers.push({ peeks: [], partial: true, progress: 10 }, { peeks: [], partial: true, progress: 60 }, { error: "the server exited" }, { peeks: [] });
    intel.peekAt("h1", 0, spot);
    await vi.advanceTimersByTimeAsync(0);
    expect(intel.peek()?.result).toEqual({ peeks: [], partial: true, progress: 10 });
    await vi.advanceTimersByTimeAsync(intel.REASK_MS);
    expect(definitionAt).toHaveBeenCalledTimes(2);
    expect(intel.peek()?.result).toEqual({ peeks: [], partial: true, progress: 60 });
    await vi.advanceTimersByTimeAsync(intel.REASK_MS);
    expect(intel.peek()?.result).toEqual({ error: "the server exited" });
    await vi.advanceTimersByTimeAsync(intel.REASK_MS * 3);
    expect(definitionAt).toHaveBeenCalledTimes(3); // a failure is not asked again by itself
    intel.retryPeek(); // its Try again
    await vi.advanceTimersByTimeAsync(0);
    expect(definitionAt).toHaveBeenCalledTimes(4);
    expect(intel.peek()?.result).toEqual({ peeks: [] });
    intel.peekAt("h1", 0, spot); // a final answer: the same click folds it away
    expect(intel.peek()).toBeNull();
    vi.useRealTimers();
  });
  it("a closed peek is not asked again", async () => {
    vi.useFakeTimers();
    definitionAt.mockClear();
    answers.push({ peeks: [], partial: true });
    intel.peekAt("h2", 0, { ...spot, line: 9 }); // not one answered already
    await vi.advanceTimersByTimeAsync(0);
    intel.closePeek();
    await vi.advanceTimersByTimeAsync(intel.REASK_MS * 3);
    expect(definitionAt).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("a hover given while the server was still reading", () => {
  it("stays on screen while asked again; another word never shows the first one's answer", async () => {
    vi.useFakeTimers();
    const later = (r: HoverResult, ms: number) => () => new Promise<HoverResult>((done) => setTimeout(() => done(r), ms));
    hoverAnswers.push(later({ markdown: "A partial", partial: true, progress: 20 }, 0), later({ markdown: "A whole" }, 1_000), later({ markdown: "B" }, 1_000));
    const a = { file: "src/A.php", line: 20, col: 1 };
    intel.pointAt(a, 0, 0);
    await vi.advanceTimersByTimeAsync(230);
    expect(intel.popover()?.result).toEqual({ markdown: "A partial", partial: true, progress: 20 });
    // asked again, slowly: what it said so far stays, no "Starting…"
    await vi.advanceTimersByTimeAsync(intel.REASK_MS + 600);
    expect(intel.popover()?.result).toEqual({ markdown: "A partial", partial: true, progress: 20 });
    await vi.advanceTimersByTimeAsync(400);
    expect(intel.popover()?.result).toEqual({ markdown: "A whole" });
    intel.pointAt({ ...a, col: 9 }, 0, 0);
    await vi.advanceTimersByTimeAsync(220 + 400);
    expect(intel.popover()?.state).toBe("loading");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(intel.popover()?.result).toEqual({ markdown: "B" });
    vi.useRealTimers();
  });
});
