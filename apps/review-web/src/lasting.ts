// A live server function's stream that outlives its connection. Held open
// for as long as the page is, it breaks whenever collagen restarts or the
// machine sleeps — and a page that stopped listening shows stale data until
// someone reloads it. So when it ends or breaks it is opened again: soon,
// then backing off to every few seconds while collagen is away. Its first
// value on reopening is how things stand now, so the page catches up on
// whatever moved in between.

const FIRST_RETRY = 500;
const LONGEST_WAIT = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function* lasting<T>(open: () => AsyncIterable<T>, wait: (ms: number) => Promise<void> = sleep): AsyncGenerator<T> {
  let delay = 0;
  for (;;) {
    try {
      for await (const value of open()) {
        delay = 0;
        yield value;
      }
    } catch {
      // broken: opened again below
    }
    delay = delay === 0 ? FIRST_RETRY : Math.min(LONGEST_WAIT, delay * 2);
    await wait(delay);
  }
}
