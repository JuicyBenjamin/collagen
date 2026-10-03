import { describe, expect, it } from "vitest";
import { lasting } from "./lasting";

/** A connection that sends `values`, then breaks (or ends). */
async function* connection(values: ReadonlyArray<string>, breaks: boolean): AsyncGenerator<string> {
  for (const v of values) yield v;
  if (breaks) throw new Error("ERR_INCOMPLETE_CHUNKED_ENCODING");
}

describe("a live stream that outlives its connection", () => {
  it("opens again when it breaks or ends, and goes on with what the new one says", async () => {
    const opened: Array<ReadonlyArray<string>> = [["a", "b"], [], [], ["c"], ["d"]];
    const waits: Array<number> = [];
    let n = 0;
    const got: Array<string> = [];
    const it = lasting(() => connection(opened[n++] ?? [], n % 2 === 1), async (ms) => void waits.push(ms));
    for await (const v of it) {
      got.push(v);
      if (got.length === 4) break;
    }
    expect(got).toEqual(["a", "b", "c", "d"]);
    // soon after a break, longer while it stays away, soon again once a value came through
    expect(waits).toEqual([500, 1000, 2000, 500]);
  });

  it("waits at most a few seconds between tries while collagen is away", async () => {
    const waits: Array<number> = [];
    const it = lasting<string>(() => connection([], true), async (ms) => {
      waits.push(ms);
      if (waits.length === 8) throw new Error("stop");
    });
    await expect(it.next()).rejects.toThrow("stop");
    expect(Math.max(...waits)).toBe(5000);
  });
});
