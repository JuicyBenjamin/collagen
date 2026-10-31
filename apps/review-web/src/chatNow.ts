import { createSignal } from "solid-js";
import { askAi, newChat, stopAnswer } from "./api";
import type { ChatSelection, ChatView, SideLine } from "./data";
import { diffNow } from "./diffNow";
import { ticketId } from "./ticket";

// The reader's conversation with their own AI, as the page holds it: the
// view their collagen streams (every turn, the answer under way growing in
// it), the lines they selected to ask about, and the offer to ask that
// follows a selection in the code. What is asked carries the commit the
// page shows, so the AI is told about the code the reader is looking at.

const [view, setView] = createSignal<ChatView | null>(null);
const [open, setOpen] = createSignal(false);
const [attached, setAttached] = createSignal<ChatSelection | null>(null);
/** Selected code and where to offer asking about it: under the selection's end, on the page. */
const [offer, setOffer] = createSignal<{ readonly selection: ChatSelection; readonly x: number; readonly y: number } | null>(null);
const [refused, setRefused] = createSignal<string | null>(null);
const [sending, setSending] = createSignal(false);
/** Moves each time the reader picks lines to ask about: the panel's input takes the focus. */
const [asking, setAsking] = createSignal(0);

/** A row of code's place on its side: a removed line by its old number, any other by its new. */
const sideLine = (row: HTMLElement): SideLine | null => {
  const del = row.classList.contains("del");
  const lineNumber = Number(del ? row.dataset.old : row.dataset.new);
  return Number.isInteger(lineNumber) && lineNumber > 0 ? { line: lineNumber, side: del ? "LEFT" : "RIGHT" } : null;
};
/** A row's code as the diff shows it: its sign, then its text. */
const rowText = (row: HTMLElement): string => {
  // a changed line (an added one that replaces a removed one) is an added one
  const sign = row.classList.contains("add") || row.classList.contains("changed") ? "+" : row.classList.contains("del") ? "-" : " ";
  return sign + [...row.querySelectorAll("td.t [data-o]")].map((element) => element.textContent ?? "").join("");
};

/** The code the reader has selected, as whole lines of one file — or null:
 *  nothing selected, or not code, or across files. */
export function selectedCode(): { readonly selection: ChatSelection; readonly end: DOMRect } | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const rowOf = (node: Node): HTMLElement | null => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("tr[data-code]") ?? null;
  const first = rowOf(range.startContainer);
  const last = rowOf(range.endContainer);
  const table = first?.closest<HTMLElement>("table[data-file]");
  if (!first || !last || !table || last.closest("table[data-file]") !== table) return null;
  const rows = [...table.querySelectorAll<HTMLElement>("tr[data-code]")];
  const firstIndex = rows.indexOf(first);
  let lastIndex = rows.indexOf(last);
  // a selection that ends before any code of its last row (a triple-click
  // runs into the next one) does not take that row
  const code = last.querySelector("td.t");
  if (lastIndex > firstIndex && code) {
    const into = document.createRange();
    into.setStart(code, 0);
    into.setEnd(range.endContainer, range.endOffset);
    if (into.toString().trim() === "") lastIndex--;
  }
  if (firstIndex < 0 || lastIndex < firstIndex) return null;
  const picked = rows.slice(firstIndex, lastIndex + 1);
  const from = sideLine(picked[0]!);
  const to = sideLine(picked[picked.length - 1]!);
  if (!from || !to) return null;
  const rects = range.getClientRects();
  const end = rects[rects.length - 1] ?? range.getBoundingClientRect();
  return { selection: { file: table.dataset.file!, from, to, text: picked.map(rowText).join("\n") }, end };
}

let watching = false;

export const chatNow = {
  view,
  open,
  attached,
  offer,
  refused,
  sending,
  asking,
  setView,
  toggle: () => setOpen(!open()),
  close: () => setOpen(false),
  detach: () => setAttached(null),
  /** Is an answer under way? */
  answering: () => (view()?.turns ?? []).some((turn) => turn.state === "answering"),
  /** Follow the reader's selection: selected code is offered to ask about. Once per page. */
  watch(): void {
    if (watching || typeof document === "undefined") return;
    watching = true;
    let soon = 0;
    document.addEventListener("selectionchange", () => {
      cancelAnimationFrame(soon);
      soon = requestAnimationFrame(() => {
        const got = selectedCode();
        setOffer(got ? { selection: got.selection, x: got.end.right + scrollX, y: got.end.bottom + scrollY } : null);
      });
    });
  },
  /** Ask about the offered lines: they go with the next question, and the panel opens on it. */
  take(): void {
    const offered = offer();
    if (!offered) return;
    setAttached(offered.selection);
    setOffer(null);
    setRefused(null);
    setOpen(true);
    setAsking((count) => count + 1);
    getSelection()?.removeAllRanges();
  },
  /** Ask the reader's AI — with the lines attached, if any. True when it is under way. */
  async ask(question: string): Promise<boolean> {
    const asked = question.trim();
    if (!asked || sending()) return false;
    setSending(true);
    setRefused(null);
    try {
      const result = await askAi(ticketId, asked, attached(), diffNow.commit() ?? null);
      if ("error" in result) {
        setRefused(result.error);
        return false;
      }
      setAttached(null);
      return true;
    } catch (error) {
      setRefused(String(error));
      return false;
    } finally {
      setSending(false);
    }
  },
  stop: () => void stopAnswer(ticketId).catch((error) => setRefused(String(error))),
  restart: () => {
    setRefused(null);
    void newChat(ticketId).catch((error) => setRefused(String(error)));
  },
};
