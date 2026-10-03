import { createSignal, type Accessor } from "solid-js";
import type { SinceResult } from "./data";
import { ticketId } from "./ticket";
import { sinceViewed } from "./api";

// What moved in a file since it was viewed, asked once per file, viewed
// commit and branch commit — every hunk of the file reads the same answer.
const asked = new Map<string, Accessor<SinceResult | "loading">>();

export const sinceOf = (file: string, from: string, to: string): Accessor<SinceResult | "loading"> => {
  const key = `${file}\n${from}\n${to}`;
  const known = asked.get(key);
  if (known) return known;
  const [result, setResult] = createSignal<SinceResult | "loading">("loading");
  asked.set(key, result);
  sinceViewed(ticketId, file, from, to)
    .then(setResult)
    .catch((e: unknown) => setResult({ error: String(e) }));
  return result;
};
