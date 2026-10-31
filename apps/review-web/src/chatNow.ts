import { createSignal, flush } from "solid-js";
import { answerInstead, askAi, forwardQuestion, newChat, stopAnswer } from "./api";
import type { ChatSelection, ChatView, SideLine } from "./data";
import { diffNow } from "./diffNow";
import { canFly } from "./floating";
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
/** The question being written: words a comment box handed over come in it. */
const [draft, setDraft] = createSignal("");
/** What a view transition is turning into the chat's panel or its pill
 *  (styles.css: ask-panel), and which of the two takes the name meanwhile:
 *  neither rises nor sinks then, the transition is its way in and out. */
export type Landing = "panel" | "pill";
const [landing, setLanding] = createSignal<Landing | null>(null);
/** A comment box is flying into the panel's input: the input holds its name (ask-box). */
const [carrying, setCarrying] = createSignal(false);
/** The chat's panel and its pill, while placed: what one becomes the other from. */
const corner: { panel?: HTMLElement; pill?: HTMLElement } = {};

/** One view transition: each of `from` lends its element the name it has
 *  there, and gives it up as `change` runs, while `into` takes it — so what
 *  was there becomes the panel or the pill. Resolves once the change is made
 *  (at once when nothing can fly), and `finished` once the flight lands. */
function morph(into: Landing, from: ReadonlyArray<readonly [HTMLElement, string]>, change: () => void): { readonly made: Promise<void>; readonly finished: Promise<void> } {
  if (!canFly()) {
    change();
    return { made: Promise.resolve(), finished: Promise.resolve() };
  }
  for (const [element, name] of from) element.style.viewTransitionName = name;
  const flight = document.startViewTransition(() => {
    // one holder of a name at a time
    for (const [element] of from) element.style.viewTransitionName = "";
    setLanding(into);
    change();
    flush();
  });
  const landed = () => {
    setLanding(null);
  };
  const finished = flight.finished.then(landed, landed);
  return { made: flight.updateCallbackDone.catch(() => undefined), finished };
}

/** The pill and the panel turning into each other, in their corner: marked
 *  on the page while it runs, so neither is drawn stretched to the other's
 *  shape (styles.css: data-corner-morph). */
function inCorner(into: Landing, from: HTMLElement, change: () => void): void {
  const page = document.documentElement;
  // which way it goes: the panel opens on a spring, and closes into the pill on a softer one
  page.dataset.cornerMorph = into;
  void morph(into, [[from, "ask-panel"]], change).finished.then(() => delete page.dataset.cornerMorph);
}
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
  draft,
  setDraft,
  landing,
  carrying,
  corner,
  setView,
  /** The pill grows into the panel. */
  openUp(): void {
    const pill = corner.pill;
    if (pill) inCorner("panel", pill, () => setOpen(true));
    else setOpen(true);
  },
  /** The panel shrinks into the pill — when there is one to come: a chat with nothing in it has none, and sinks. */
  close(): void {
    const panel = corner.panel;
    if (panel && (view()?.turns.length ?? 0) > 0) inCorner("pill", panel, () => setOpen(false));
    else setOpen(false);
  },
  detach: () => setAttached(null),
  /** Is an answer under way? */
  /** the reader's own AI is answering — an author's AI answering is not in the way */
  answering: () => (view()?.turns ?? []).some((turn) => turn.state === "answering" && turn.from === undefined),
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
    setOffer(null);
    getSelection()?.removeAllRanges();
    chatNow.askAbout(offered.selection);
  },
  /** Ask about these lines (picked in the margin, or selected): they go with the next question, after any words already begun. */
  askAbout(selection: ChatSelection, words = ""): void {
    setAttached(selection);
    if (words.trim()) setDraft(words);
    setRefused(null);
    setOpen(true);
    setAsking((count) => count + 1);
  },
  /** A comment form turns into the question: its lines and words go to the
   *  chat, and the form becomes the chat's panel, its box the panel's input
   *  (one view transition, styles.css: ask-panel, ask-box), so one box is
   *  open at a time and the flight is the panel's entrance. `away` takes the
   *  comment form's place away, folding shut as it flies. */
  handOver(selection: ChatSelection, words: string, from: { readonly form: HTMLElement; readonly box: HTMLElement }, away: () => void): void {
    setCarrying(true);
    const flight = morph(
      "panel",
      [
        [from.form, "ask-panel"],
        [from.box, "ask-box"],
      ],
      () => {
        from.form.style.visibility = "hidden";
        chatNow.askAbout(selection, words);
      },
    );
    void flight.made.then(away);
    void flight.finished.then(() => setCarrying(false));
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
  /** in the author's place: the reader's AI assumes why, or assumes and critiques it */
  instead: async (turnId: string, mode: "assume" | "critique") => {
    setRefused(null);
    const said = await answerInstead(ticketId, turnId, mode).catch((error): { error: string } => ({ error: String(error) }));
    if ("error" in said) setRefused(said.error);
  },
  /** the reader's word: ask the review's author's AI what the why did not say */
  forward: async (turnId: string) => {
    setRefused(null);
    const said = await forwardQuestion(ticketId, turnId).catch((error): { error: string } => ({ error: String(error) }));
    if ("error" in said) setRefused(said.error);
  },
  restart: () => {
    setRefused(null);
    void newChat(ticketId).catch((error) => setRefused(String(error)));
  },
};
