/** Two-letter avatar text for a room name: first letters of the first two
 *  words ("dev room" → "DR"), or the first two characters of a single word
 *  ("work" → "WO", "6f056449" → "6F"). */
export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  const text = words.length >= 2 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2);
  return text.toUpperCase().padEnd(2, " ");
}
