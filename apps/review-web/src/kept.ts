// What a part said the last time this review was open, kept in this
// browser: its placeholder masks those very words next time, so it is as
// wide and as tall as what comes. A private window or full storage keeps
// nothing, and the placeholder guesses.

/** One part's last words, for this review: the last kept (if it has the
 *  shape the part reads), and how to keep the next. */
export function kept<Value>(
  key: string,
  fits: (value: unknown) => value is Value,
): { readonly last: Value | null; readonly keep: (value: Value) => void } {
  const last = (() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      return fits(value) ? value : null;
    } catch {
      return null;
    }
  })();
  const keep = (value: Value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // nothing kept: the next open guesses
    }
  };
  return { last, keep };
}
