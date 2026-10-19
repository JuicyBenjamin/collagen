// A live server function's stream that outlives its connection. Held open
// for as long as the page is, it breaks whenever collagen restarts or the
// machine sleeps — and a page that stopped listening shows stale data until
// someone reloads it. So when it ends or breaks it is opened again: soon,
// then backing off to every few seconds while collagen is away. Its first
// value on reopening is how things stand now, so the page catches up on
// whatever moved in between.
// While its tab is out of sight it lets go of its connection, and opens it
// again when the tab is looked at: a browser keeps only six connections to
// collagen, and every live stream holds one — a few review tabs left open
// would hold them all, and a new page would wait for one with no end and no
// error. Reopened, it catches up as after a break.
// Not an async generator: a generator's return() waits behind a pending
// next(), and a live stream's next() waits for the next change — so when
// the page lets go of it (a banner replaced, a memo re-run), the connection
// beneath would stay open and the retries go on. Here return() closes the
// open connection and cuts a backoff short at once.

const FIRST_RETRY = 500;
const LONGEST_WAIT = 5_000;

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Whether the page is in sight, and word when that changes. */
export interface Sight {
  readonly hidden: () => boolean;
  readonly onChange: (changed: () => void) => () => void;
}

/** The document's: hidden while its tab is in the background or minimised. */
const documentSight: Sight = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  onChange: (changed) => {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  },
};

export const lasting = <T>(open: () => AsyncIterable<T>, wait: (ms: number) => Promise<void> = sleep, sight: Sight = documentSight): AsyncIterable<T> => ({
  [Symbol.asyncIterator](): AsyncIterator<T> {
    let stopped = false;
    let current: AsyncIterator<T> | null = null;
    let delay = 0;
    let wake = () => {};
    const done = (): IteratorResult<T> => ({ value: undefined, done: true });
    // out of sight: the open connection is let go; in sight again, whatever waits goes on
    let shown = () => {};
    const unwatch = sight.onChange(() => {
      if (sight.hidden()) {
        const it = current;
        current = null;
        void it?.return?.().catch(() => undefined);
      } else shown();
      wake();
    });
    const inSight = () => new Promise<void>((resolve) => (shown = resolve));
    return {
      async next() {
        while (!stopped) {
          // out of sight, nothing is opened: looked at again, the loop goes round
          if (sight.hidden()) {
            await inSight();
            continue;
          }
          const it = (current ??= open()[Symbol.asyncIterator]());
          try {
            const result = await it.next();
            if (stopped) break;
            if (!result.done) {
              delay = 0;
              return result;
            }
          } catch {
            // broken: opened again below
          }
          if (stopped) break;
          // let go because the tab went out of sight: no break to back off from
          if (sight.hidden()) {
            current = null;
            delay = 0;
            continue;
          }
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
        unwatch();
        const it = current;
        current = null;
        wake();
        shown();
        // the live stream's own return aborts its request and its retries
        await it?.return?.().catch(() => undefined);
        return done();
      },
    };
  },
});
