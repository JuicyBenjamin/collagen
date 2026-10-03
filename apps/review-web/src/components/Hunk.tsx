import { createMemo, createSignal, For, Show } from "solid-js";
import type { Decision, DiffLine, Hunk as HunkData, WholeFileResult } from "../data";
import { diffNow } from "../diffNow";
import { ticketId } from "../ticket";
import { hasNewSide, wholeHunk } from "../whole";
import { highlightHunk } from "../highlight";
import { markWord, peek, peekAt, pointAt, readyFor, wordAt, wordEnd, type Spot } from "../intel";
import { AlsoUnder } from "./AlsoUnder";
import { CodeLine } from "./Code";
import { Peek } from "./Peek";
import { viewed } from "../viewedNow";

/** The character a pointer is over, in a line drawn by CodeLine: the text
 *  under the pointer, and where its span starts (data-o). */
function charAt(x: number, y: number): { readonly col: number; readonly node: Node; readonly offset: number } | null {
  const pos = document.caretPositionFromPoint?.(x, y);
  const node = pos?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
  const offset = pos?.offset ?? document.caretRangeFromPoint?.(x, y)?.startOffset ?? 0;
  const span = node?.parentElement?.closest("[data-o]");
  if (!node || !span) return null;
  return { col: Number(span.getAttribute("data-o")) + offset, node, offset };
}

/** One hunk: file and header, then its lines with old and new numbers, each
 *  line's code coloured by TanStack Highlight as spans of its own — never
 *  set as HTML. On a file a language server reads (once it is installed), a
 *  word on an added or unchanged line answers to the pointer: rest on it for
 *  its type, click it to peek where it is declared (removed lines are the
 *  base's, not asked). */
export function Hunk(props: { hunk: HunkData; alsoUnder: ReadonlyArray<Decision> }) {
  // the file whole, on the reader's word: asked once, kept while the page is
  const [whole, setWhole] = createSignal<WholeFileResult | "loading" | null>(null);
  const [open, setOpen] = createSignal(false);
  let box: HTMLDivElement | undefined;
  const shown = createMemo((): HunkData => {
    const w = whole();
    return open() && w && w !== "loading" && "lines" in w ? wholeHunk(props.hunk, w.lines, diffNow.addedIn(props.hunk.file)) : props.hunk;
  });
  const failed = () => {
    const w = whole();
    return open() && w && w !== "loading" && "error" in w ? w.error : null;
  };
  // opened at the change, not at the top of the file
  const toChange = () =>
    requestAnimationFrame(() => {
      const row = box?.querySelector<HTMLElement>(`tr[data-new="${props.hunk.newStart}"]`);
      if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 3);
    });
  const toggleWhole = async () => {
    if (open()) return setOpen(false);
    setOpen(true);
    // asked once; asked again only after it failed
    const w = whole();
    if (w === null || (w !== "loading" && "error" in w)) {
      setWhole("loading");
      try {
        const res = await fetch(`/review/${encodeURIComponent(ticketId)}/file?file=${encodeURIComponent(props.hunk.file)}`);
        setWhole(res.ok ? ((await res.json()) as WholeFileResult) : { error: await res.text() });
      } catch (e) {
        setWhole({ error: String(e) });
      }
    }
    toChange();
  };
  const spans = createMemo(() => highlightHunk(shown()));
  // read already: the file folds to its header here and wherever else it shows
  const state = () => viewed.state(props.hunk.file);
  const asks = () => readyFor(props.hunk.file);

  /** The word under the pointer on this line, as a spot in the branch, and
   *  the range of text it covers (to mark it). */
  const wordUnder = (line: DiffLine, e: MouseEvent): { spot: Spot; range: Range | null } | null => {
    if (!asks() || line.new === undefined) return null;
    const at = charAt(e.clientX, e.clientY);
    const start = at === null ? null : wordAt(line.text, at.col);
    if (at === null || start === null) return null;
    const len = at.node.textContent?.length ?? 0;
    const range = document.createRange();
    range.setStart(at.node, Math.max(0, at.offset - (at.col - start)));
    range.setEnd(at.node, Math.min(len, at.offset + (wordEnd(line.text, start) - at.col)));
    return { spot: { file: props.hunk.file, line: line.new, col: start }, range };
  };
  const spotAt = (line: DiffLine, e: MouseEvent): Spot | null => wordUnder(line, e)?.spot ?? null;

  return (
    <div class={["hunk", { viewed: state() === "viewed" }]}>
      <div class="file">
        <span class="head">{props.hunk.file}</span>
        <span class="file-side">
          <AlsoUnder decisions={props.alsoUnder} />
          <Show when={diffNow.canReadWhole() && hasNewSide(props.hunk) && state() !== "viewed"}>
            <button type="button" class="whole-toggle" onClick={() => void toggleWhole()} title="The whole file as the branch has it, this diff's added lines marked">
              {open() ? (whole() === "loading" ? "Reading…" : "Just the change") : "Whole file"}
            </button>
          </Show>
          <label class={["mark-viewed", { changed: state() === "changed" }]} title="Fold this file everywhere on the page, as read; it opens again if its changes move">
            <input type="checkbox" checked={state() === "viewed"} onChange={() => viewed.toggle(props.hunk.file)} />
            {state() === "changed" ? "Changed since viewed" : "Viewed"}
          </label>
        </span>
      </div>
      <Show when={state() !== "viewed"}>
      <Show when={failed()}>{(why) => <p class="whole-failed">Could not read the whole file: {why()}</p>}</Show>
      <div class={["code", { whole: shown() !== props.hunk }]} ref={box}>
        <table>
          <tbody>
            <For each={shown().lines}>
              {(line, i) => (
                <>
                  <tr class={{ add: line.kind === "+", del: line.kind === "-" }} data-new={line.new}>
                    <td class="n">{line.old ?? ""}</td>
                    <td class="n">{line.new ?? ""}</td>
                    <td
                      class={["t", { asks: asks() && line.new !== undefined }]}
                      onMouseMove={(e) => {
                        const w = wordUnder(line, e);
                        // a word is something to click: say so with the pointer and a mark
                        e.currentTarget.classList.toggle("on-word", w !== null);
                        markWord(w?.range ?? null);
                        pointAt(w?.spot ?? null, e.clientX, e.clientY);
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.classList.remove("on-word");
                        markWord(null);
                        pointAt(null, 0, 0);
                      }}
                      onClick={(e) => {
                        // a click that selected text is a selection, not a peek
                        if (getSelection()?.toString()) return;
                        const spot = spotAt(line, e);
                        if (spot) {
                          pointAt(null, 0, 0);
                          peekAt(shown().id, i(), spot);
                        }
                      }}
                    >
                      <span class="sign">{line.kind === " " ? " " : line.kind}</span>
                      <CodeLine spans={spans()[i()] ?? []} />
                    </td>
                  </tr>
                  <Show when={peek()?.hunk === shown().id && peek()?.index === i() ? peek() : null}>
                    {(p) => (
                      <tr class="peek-row">
                        <td colspan={3}>
                          <Peek result={p().result} />
                        </td>
                      </tr>
                    )}
                  </Show>
                </>
              )}
            </For>
          </tbody>
        </table>
      </div>
      </Show>
    </div>
  );
}
