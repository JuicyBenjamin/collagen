import { For } from "solid-js";
import type { Span } from "../highlight";

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
