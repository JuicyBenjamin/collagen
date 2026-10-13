import { For } from "solid-js";
import type { Span } from "../highlight";
import { spansIn, type Segment } from "../inline";

/** One line of coloured code: the spans as the page's own elements, each
 *  carrying where it starts in the line (data-o), so a pointer over it can
 *  be turned back into a character. */
export function CodeLine(props: { spans: ReadonlyArray<Span> }) {
  const starts = () => {
    let o = 0;
    return props.spans.map((s) => {
      const at = o;
      o += s.value.length;
      return at;
    });
  };
  return (
    <For each={props.spans}>
      {(s, i) => (
        <span class={s.className ? `th-${s.className}` : undefined} data-o={starts()[i()]}>
          {s.value}
        </span>
      )}
    </For>
  );
}

/** A line changed in place: its words as segments, what stayed and what came
 *  coloured as the new line has them, what went as the old line had it. Only
 *  the new line's text carries offsets (data-o): a pointer over what went
 *  finds no word, as it is not the branch's. */
export function ChangedLine(props: { segments: ReadonlyArray<Segment>; old: { readonly text: string; readonly spans: ReadonlyArray<Span> }; now: { readonly text: string; readonly spans: ReadonlyArray<Span> } }) {
  return (
    <For each={props.segments}>
      {(seg) => {
        const from = seg.kind === "removed" ? props.old : props.now;
        const parts = () => spansIn(from.spans, from.text, seg.at, seg.at + seg.text.length);
        const body = (
          <For each={parts()}>
            {(p) => (
              <span class={p.span.className ? `th-${p.span.className}` : undefined} data-o={seg.kind === "removed" ? undefined : p.at}>
                {p.span.value}
              </span>
            )}
          </For>
        );
        return seg.kind === "same" ? body : <span class={seg.kind === "removed" ? "went" : "came"}>{body}</span>;
      }}
    </For>
  );
}
