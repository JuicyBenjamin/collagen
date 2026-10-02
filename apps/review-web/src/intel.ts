import { createSignal } from "solid-js";
import type { DefinitionResult, HoverResult } from "./data";
import { ticketId } from "./ticket";

// The type checker, asked from the page: what is this symbol (hover) and
// where is it declared (peek). The answers come from collagen's own
// TypeScript 7 run over the branch under review (cli services/ReviewTypes);
// the page only says where the reader is pointing — a file of the branch, a
// line, a character — and draws what comes back. Module-level state: one
// popover and one peek on the page at a time.

/** A position in the branch: the new side of the diff, as editors count —
 *  lines from 1, characters from 0. */
export interface Spot {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

const key = (s: Spot) => `${s.file}:${s.line}:${s.col}`;
const ask = <A>(what: "hover" | "definition", s: Spot, cache: Map<string, Promise<A>>): Promise<A> => {
  const k = key(s);
  let p = cache.get(k);
  if (!p) {
    const q = new URLSearchParams({ file: s.file, line: String(s.line), col: String(s.col) });
    p = fetch(`/review/${encodeURIComponent(ticketId)}/${what}?${q}`).then((r) => (r.ok ? (r.json() as Promise<A>) : r.text().then((t) => ({ error: t }) as A)));
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return p;
};
const hovers = new Map<string, Promise<HoverResult>>();
const definitions = new Map<string, Promise<DefinitionResult>>();

/** The word under a character of a line: where it starts, or null when the
 *  character is not part of an identifier (space, punctuation, a string's
 *  quote…). Hovering is per word: the start is what is asked and cached. */
export function wordAt(text: string, col: number): number | null {
  const id = /[A-Za-z0-9_$]/;
  if (!id.test(text[col] ?? "")) return null;
  let start = col;
  while (start > 0 && id.test(text[start - 1]!)) start--;
  return /[0-9]/.test(text[start]!) ? null : start;
}

export interface Popover {
  readonly x: number;
  readonly y: number;
  readonly state: "loading" | "ready";
  readonly result?: HoverResult;
}

const [popover, setPopover] = createSignal<Popover | null>(null);
export { popover };

let pending: { spot: Spot; timer: ReturnType<typeof setTimeout> } | null = null;

/** The pointer rests on a word: after a breath, ask what it is. Moving to
 *  another word asks again; leaving the code closes it. */
export function pointAt(spot: Spot | null, x: number, y: number): void {
  if (spot && pending && key(pending.spot) === key(spot)) return;
  if (pending) clearTimeout(pending.timer);
  pending = null;
  if (!spot) {
    setPopover(null);
    return;
  }
  const timer = setTimeout(() => {
    // a slow first answer (the server starting) says so rather than nothing
    const slow = setTimeout(() => pending?.spot === spot && setPopover({ x, y, state: "loading" }), 400);
    void ask("hover", spot, hovers).then((result) => {
      clearTimeout(slow);
      if (pending?.spot !== spot) return;
      setPopover("none" in result ? null : { x, y, state: "ready", result });
    });
  }, 220);
  pending = { spot, timer };
}

export interface PeekAt {
  readonly hunk: string;
  readonly index: number;
  readonly spot: Spot;
  readonly result: DefinitionResult | null;
}

const [peek, setPeek] = createSignal<PeekAt | null>(null);
export { peek };

/** A click on a word peeks where it is declared, under the line; a click on
 *  the same word, the ×, or Esc folds it away. */
export function peekAt(hunk: string, index: number, spot: Spot): void {
  const now = peek();
  if (now && now.hunk === hunk && now.index === index && key(now.spot) === key(spot)) return closePeek();
  setPeek({ hunk, index, spot, result: null });
  void ask("definition", spot, definitions).then((result) => {
    const still = peek();
    if (still && key(still.spot) === key(spot)) setPeek({ ...still, result });
  });
}

export function closePeek(): void {
  setPeek(null);
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePeek();
    setPopover(null);
  }
});
