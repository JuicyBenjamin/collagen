/** A count as a person reads it: 1.2k, 3.4M. */
export const compact = (count: number): string =>
  count >= 1e9 ? `${(count / 1e9).toFixed(1)}B` : count >= 1e6 ? `${(count / 1e6).toFixed(count >= 1e7 ? 0 : 1)}M` : count >= 1e3 ? `${(count / 1e3).toFixed(count >= 1e4 ? 0 : 1)}k` : String(Math.round(count));
