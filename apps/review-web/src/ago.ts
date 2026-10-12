/** "just now", "4 min ago", "3 h ago", a date — from `now`. */
export const ago = (t: number, now: number): string => {
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(t).toLocaleDateString();
};
