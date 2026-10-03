import { describe, expect, it } from "vitest";
import { lasting } from "./lasting";

/** A connection that sends `values`, then breaks (or ends). */
async function* connection(values: ReadonlyArray<string>, breaks: boolean): AsyncGenerator<string> {
  for (const v of values) yield v;
  if (breaks) throw new Error("ERR_INCOMPLETE_CHUNKED_ENCODING");
}

/** A live connection: its first value, then waiting for a change that never
 *  comes — until it is told to stop, as Solid's live stream is. */
const waiting = (first: string) => {
  const told = { returns: 0 };
  let release = () => {};
  let sent = false;
  const iterator: AsyncIterator<string> = {
    next: () => (sent ? new Promise((resolve) => (release = () => resolve({ value: undefined, done: true }))) : ((sent = true), Promise.resolve({ value: first, done: false }))),
    return: async () => {
      told.returns++;
      release();
      return { value: undefined, done: true };
    },
  };
  return { told, iterable: { [Symbol.asyncIterator]: () => iterator } };
};

describe("a live stream that outlives its connection", () => {
  it("opens again when it breaks or ends, and goes on with what the new one says", async () => {
    const opened: Array<ReadonlyArray<string>> = [["a", "b"], [], [], ["c"], ["d"]];
    const waits: Array<number> = [];
    let n = 0;
    const got: Array<string> = [];
    for await (const v of lasting(() => connection(opened[n++] ?? [], n % 2 === 1), async (ms) => void waits.push(ms))) {
      got.push(v);
      if (got.length === 4) break;
    }
    expect(got).toEqual(["a", "b", "c", "d"]);
    // soon after a break, longer while it stays away, soon again once a value came through
    expect(waits).toEqual([500, 1000, 2000, 500]);
  });

  it("waits at most a few seconds between tries while collagen is away", async () => {
    const waits: Array<number> = [];
    let eighth = () => {};
    const reached = new Promise<void>((r) => (eighth = r));
    const it = lasting<string>(
      () => connection([], true),
      (ms) => {
        waits.push(ms);
        if (waits.length < 8) return Promise.resolve();
        eighth();
        return new Promise(() => {});
      },
    )[Symbol.asyncIterator]();
    const pending = it.next();
    await reached;
    await it.return!();
    await pending;
    expect(waits).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000, 5000]);
  });

  it("let go while waiting for a change: the connection is closed at once, the pending read ends", async () => {
    const live = waiting("t1");
    let opens = 0;
    const it = lasting(() => (opens++, live.iterable), () => new Promise(() => {}))[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: "t1", done: false });
    const pending = it.next();
    await it.return!();
    expect(live.told.returns).toBe(1);
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(opens).toBe(1);
  });

  it("let go while backing off: no further try", async () => {
    let opens = 0;
    const it = lasting<string>(() => (opens++, connection([], true)), () => new Promise(() => {}))[Symbol.asyncIterator]();
    const pending = it.next();
    await new Promise((r) => setTimeout(r, 0));
    await it.return!();
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(opens).toBe(1);
  });
});
