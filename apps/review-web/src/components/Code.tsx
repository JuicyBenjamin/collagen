import { createSignal, For, Show } from "solid-js";
import { Portal } from "@solidjs/web";
import type { Span } from "../highlight";
import { spansIn, type Segment, type Was } from "../inline";

/** One line of coloured code: the spans as the page's own elements, each
 *  carrying where it starts in the line (data-o), so a pointer over it can
 *  be turned back into a character. */
export function CodeLine(props: { spans: ReadonlyArray<Span> }) {
  const starts = () => {
    let offset = 0;
    return props.spans.map((span) => {
      const at = offset;
      offset += span.value.length;
      return at;
    });
  };
  return (
    <For each={props.spans}>
      {(span, index) => (
        <span class={span.className ? `th-${span.className}` : undefined} data-o={starts()[index()]}>
          {span.value}
        </span>
      )}
    </For>
  );
}

/** The character under a pointer in a drawn line: its span's start (data-o) plus the offset in it. */
const colAt = (pointerX: number, pointerY: number): number | null => {
  const pos = document.caretPositionFromPoint?.(pointerX, pointerY);
  const node = pos?.offsetNode ?? document.caretRangeFromPoint?.(pointerX, pointerY)?.startContainer;
  const offset = pos?.offset ?? document.caretRangeFromPoint?.(pointerX, pointerY)?.startOffset ?? 0;
  const span = node?.parentElement?.closest("[data-o]");
  return node && span ? Number(span.getAttribute("data-o")) + offset : null;
};

/** The word of the old line that the new line's character `col` stood in, as [from, to). */
const wasWordAt = (map: ReadonlyArray<Was>, old: string, col: number): readonly [number, number] | null => {
  const match = map.find((word) => col >= word.now && col < word.now + word.length);
  if (!match) return null;
  const at = match.was + (col - match.now);
  const isWord = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}_$]/u.test(character);
  if (!isWord(old[at])) return [match.was, match.was + match.length];
  let from = at;
  let to = at;
  while (from > 0 && isWord(old[from - 1])) from--;
  while (to < old.length && isWord(old[to])) to++;
  return [from, to];
};

/** A line changed in place: its words as segments, what stayed and what came
 *  coloured as the new line has them, what went as the old line had it, what
 *  only moved underlined where it is now. Only the new line's text carries
 *  offsets (data-o): a pointer over what went finds no word, as it is not the
 *  branch's. Pointing at the line shows it as it was, in a box above it that
 *  pushes nothing aside, the word under the pointer lit where it stood. */
export function ChangedLine(props: {
  segments: ReadonlyArray<Segment>;
  old: { readonly text: string; readonly spans: ReadonlyArray<Span> };
  now: { readonly text: string; readonly spans: ReadonlyArray<Span> };
  map: ReadonlyArray<Was>;
}) {
  const [before, setBefore] = createSignal<{ readonly left: number; readonly bottom: number; readonly width: number; readonly lit: readonly [number, number] | null } | null>(null);
  let line: HTMLSpanElement | undefined;
  const point = (event: MouseEvent) => {
    const cell = line?.closest("td")?.getBoundingClientRect();
    if (!cell) return;
    const col = colAt(event.clientX, event.clientY);
    setBefore({ left: cell.left, bottom: innerHeight - cell.top + 4, width: cell.width, lit: col === null ? null : wasWordAt(props.map, props.old.text, col) });
  };
  return (
    <span class="changed-line" ref={line} onMouseMove={point} onMouseLeave={() => setBefore(null)}>
      <For each={props.segments}>
        {(seg) => {
          const from = seg.kind === "removed" ? props.old : props.now;
          const parts = () => spansIn(from.spans, from.text, seg.at, seg.at + seg.text.length);
          const body = (
            <For each={parts()}>
              {(part) => (
                <span class={part.span.className ? `th-${part.span.className}` : undefined} data-o={seg.kind === "removed" ? undefined : part.at}>
                  {part.span.value}
                </span>
              )}
            </For>
          );
          if (seg.kind === "same") return body;
          if (seg.kind === "moved") return <span class="moved">{body}</span>;
          return <span class={seg.kind === "removed" ? "went" : "came"}>{body}</span>;
        }}
      </For>
      <Show when={before()}>
        {(preview) => (
          <Portal>
            <div class="before" style={{ left: `${preview().left}px`, bottom: `${preview().bottom}px`, "max-width": `${preview().width}px` }}>
              <span class="before-label">before</span>
              <code>
                <Show when={preview().lit} fallback={props.old.text}>
                  {(lit) => (
                    <>
                      {props.old.text.slice(0, lit()[0])}
                      <mark>{props.old.text.slice(lit()[0], lit()[1])}</mark>
                      {props.old.text.slice(lit()[1])}
                    </>
                  )}
                </Show>
              </code>
            </div>
          </Portal>
        )}
      </Show>
    </span>
  );
}
