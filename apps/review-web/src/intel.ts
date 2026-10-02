import { createSignal } from "solid-js";
import { final, toolOf, type DefinitionResult, type HoverResult, type ToolId, type ToolState } from "./data";
import { ticketId } from "./ticket";

// The language servers, asked from the page: what is this symbol (hover)
// and where is it declared (peek). The answers come from collagen's own
// pinned server for the file's language, run over the branch under review
// (cli services/ReviewTypes); the page only says where the reader is
// pointing — a file of the branch, a line, a character — and draws what
// comes back. Module-level state: one popover and one peek at a time.

/** A position in the branch: the new side of the diff, as editors count —
 *  lines from 1, characters from 0. */
export interface Spot {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

/** Each language's pinned server, as the instance reports it. The page asks
 *  once per language the review has, and again every second while an
 *  install runs. */
const [tools, setTools] = createSignal<Readonly<Partial<Record<ToolId, ToolState>>>>({});
export const toolState = (id: ToolId): ToolState | undefined => tools()[id];
const keep = (t: ToolState) => setTools((all) => ({ ...all, [t.tool]: t }));

/** Can a word in this file be asked about right now? */
export const readyFor = (file: string): boolean => {
  const id = toolOf(file);
  return id !== null && toolState(id)?.state === "ready";
};

/** The server's name for a file, for "Starting <name>…". */
export const toolNameFor = (file: string): string => {
  const id = toolOf(file);
  return (id && toolState(id)?.name) ?? "the language server";
};

export async function refreshTool(id: ToolId): Promise<void> {
  const r = await fetch(`/review-tools/${id}`);
  if (r.ok) keep((await r.json()) as ToolState);
}

/** Install it — only ever on the person's click. */
export async function installTool(id: ToolId): Promise<void> {
  const r = await fetch(`/review-tools/${id}`, { method: "POST", headers: { "x-collagen": "install" } });
  if (r.ok) keep((await r.json()) as ToolState);
}

const key = (s: Spot) => `${s.file}:${s.line}:${s.col}`;
const ask = <A>(what: "hover" | "definition", s: Spot, cache: Map<string, Promise<A>>): Promise<A> => {
  const k = key(s);
  let p = cache.get(k);
  if (!p) {
    const q = new URLSearchParams({ file: s.file, line: String(s.line), col: String(s.col) });
    p = fetch(`/review/${encodeURIComponent(ticketId)}/${what}?${q}`).then((r) => (r.ok ? (r.json() as Promise<A>) : r.text().then((t) => ({ error: t }) as A)));
    // only a final answer is kept: one given mid-index, or a failure, is
    // asked again next time rather than standing until a reload
    p.then((r) => !final(r as HoverResult | DefinitionResult) && cache.delete(k), () => cache.delete(k));
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

/** The word under the pointer, marked in place — underlined, through the
 *  CSS Highlight API, so no element changes — where the browser has it. */
const marks = typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights : null;
export function markWord(range: Range | null): void {
  if (!marks) return;
  const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (range && Highlight) marks.set("word", new Highlight(range));
  else marks.delete("word");
}

/** Where a word ends, from where it starts. */
export const wordEnd = (text: string, start: number): number => {
  let end = start;
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end]!)) end++;
  return end;
};

export interface Popover {
  readonly x: number;
  readonly y: number;
  readonly file: string;
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
    const slow = setTimeout(() => pending?.spot === spot && setPopover({ x, y, file: spot.file, state: "loading" }), 400);
    void ask("hover", spot, hovers).then((result) => {
      clearTimeout(slow);
      if (pending?.spot !== spot) return;
      // nothing to say is no popover — unless the server was still reading,
      // when "nothing yet" is worth saying rather than looking definitive
      setPopover("none" in result && !result.partial ? null : { x, y, file: spot.file, state: "ready", result });
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
 *  the same word, the ×, or Esc folds it away — except while the answer is
 *  not a final one (the server still reading, or a failure): then the same
 *  click asks again, as the peek says. */
export function peekAt(hunk: string, index: number, spot: Spot): void {
  const now = peek();
  const same = now !== null && now.hunk === hunk && now.index === index && key(now.spot) === key(spot);
  if (same && now.result !== null && final(now.result)) return closePeek();
  if (same && now.result === null) return; // still asking
  setPeek({ hunk, index, spot, result: null });
  void ask("definition", spot, definitions).then((result) => {
    const still = peek();
    if (still && key(still.spot) === key(spot)) setPeek({ ...still, result });
  });
}

/** Ask the open peek's question again (its Try again). */
export function retryPeek(): void {
  const now = peek();
  if (now) peekAt(now.hunk, now.index, now.spot);
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
