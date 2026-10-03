// A live server function's stream that outlives its connection. Held open
// for as long as the page is, it breaks whenever collagen restarts or the
// machine sleeps — and a page that stopped listening shows stale data until
// someone reloads it. So when it ends or breaks it is opened again: soon,
// then backing off to every few seconds while collagen is away. Its first
// value on reopening is how things stand now, so the page catches up on
// whatever moved in between.
// Not an async generator: a generator's return() waits behind a pending
// next(), and a live stream's next() waits for the next change — so when
// the page lets go of it (a banner replaced, a memo re-run), the connection
// beneath would stay open and the retries go on. Here return() closes the
// open connection and cuts a backoff short at once.

const FIRST_RETRY = 500;
const LONGEST_WAIT = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const lasting = <T>(open: () => AsyncIterable<T>, wait: (ms: number) => Promise<void> = sleep): AsyncIterable<T> => ({
  [Symbol.asyncIterator](): AsyncIterator<T> {
    let stopped = false;
    let current: AsyncIterator<T> | null = null;
    let delay = 0;
    let wake = () => {};
    const done = (): IteratorResult<T> => ({ value: undefined, done: true });
    return {
      async next() {
        while (!stopped) {
          const it = (current ??= open()[Symbol.asyncIterator]());
          try {
            const r = await it.next();
            if (stopped) break;
            if (!r.done) {
              delay = 0;
              return r;
            }
          } catch {
            // broken: opened again below
          }
          if (stopped) break;
          current = null;
          delay = delay === 0 ? FIRST_RETRY : Math.min(LONGEST_WAIT, delay * 2);
          await new Promise<void>((resolve) => {
            wake = resolve;
            void wait(delay).then(resolve);
          });
        }
        return done();
      },
      async return() {
        stopped = true;
        const it = current;
        current = null;
        wake();
        // the live stream's own return aborts its request and its retries
        await it?.return?.().catch(() => undefined);
        return done();
      },
    };
  },
});
