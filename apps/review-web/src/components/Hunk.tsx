import { createMemo, For, Show } from "solid-js";
import type { Decision, DiffLine, Hunk as HunkData } from "../data";
import { highlightHunk } from "../highlight";
import { markWord, peek, peekAt, pointAt, readyFor, wordAt, wordEnd, type Spot } from "../intel";
import { AlsoUnder } from "./AlsoUnder";
import { CodeLine } from "./Code";
import { Peek } from "./Peek";

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
  const spans = createMemo(() => highlightHunk(props.hunk));
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
    <div class="hunk">
      <div class="file">
        <span class="head">{props.hunk.file}</span>
        <AlsoUnder decisions={props.alsoUnder} />
      </div>
      <div class="code">
        <table>
          <tbody>
            <For each={props.hunk.lines}>
              {(line, i) => (
                <>
                  <tr class={{ add: line.kind === "+", del: line.kind === "-" }}>
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
                          peekAt(props.hunk.id, i(), spot);
                        }
                      }}
                    >
                      <span class="sign">{line.kind === " " ? " " : line.kind}</span>
                      <CodeLine spans={spans()[i()] ?? []} />
                    </td>
                  </tr>
                  <Show when={peek()?.hunk === props.hunk.id && peek()?.index === i() ? peek() : null}>
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
    </div>
  );
}
