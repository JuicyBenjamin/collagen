import { describe, expect, it } from "vitest";
import { lasting, type Sight } from "./lasting";

/** A connection that sends `values`, then breaks (or ends). */
async function* connection(values: ReadonlyArray<string>, breaks: boolean): AsyncGenerator<string> {
  for (const value of values) yield value;
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
    let attempts = 0;
    const got: Array<string> = [];
    for await (const value of lasting(() => connection(opened[attempts++] ?? [], attempts % 2 === 1), async (milliseconds) => void waits.push(milliseconds))) {
      got.push(value);
      if (got.length === 4) break;
    }
    expect(got).toEqual(["a", "b", "c", "d"]);
    // soon after a break, longer while it stays away, soon again once a value came through
    expect(waits).toEqual([500, 1000, 2000, 500]);
  });

  it("waits at most a few seconds between tries while collagen is away", async () => {
    const waits: Array<number> = [];
    let eighth = () => {};
    const reached = new Promise<void>((resolve) => (eighth = resolve));
    const it = lasting<string>(
      () => connection([], true),
      (milliseconds) => {
        waits.push(milliseconds);
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    await it.return!();
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(opens).toBe(1);
  });

  it("holds no connection while its tab is out of sight, and catches up when it is looked at", async () => {
    let hidden = false;
    let changed = () => {};
    const sight: Sight = { hidden: () => hidden, onChange: (listener) => ((changed = listener), () => {}) };
    const connections: Array<ReturnType<typeof waiting>> = [];
    const stream = lasting(
      () => {
        const connection = waiting(`now ${connections.length + 1}`);
        connections.push(connection);
        return connection.iterable;
      },
      async () => {},
      sight,
    )[Symbol.asyncIterator]();
    expect((await stream.next()).value).toBe("now 1");
    // waiting for a change on the first connection, the tab goes out of sight
    const pending = stream.next();
    hidden = true;
    changed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connections[0]!.told.returns).toBe(1);
    expect(connections).toHaveLength(1);
    // looked at again: one new connection, its first value how things stand now
    hidden = false;
    changed();
    expect((await pending).value).toBe("now 2");
    expect(connections).toHaveLength(2);
    await stream.return?.();
  });
});
