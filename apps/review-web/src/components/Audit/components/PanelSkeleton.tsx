import { For, Show, type Element } from "solid-js";
import { Pending } from "./Pending";

/** A panel before its numbers are in: what is known shown as it will be —
 *  its title, a subtitle that does not depend on the numbers, its legend —
 *  and only the numbers masked: a line of them (`pending`), and the chart's
 *  own area at the height it will have, so nothing moves when it lands. */
export function PanelSkeleton(props: {
  title: string;
  sub?: string;
  pending?: string;
  legend?: ReadonlyArray<{ readonly label: string; readonly colour: string }>;
  height?: number;
  children?: Element;
}) {
  return (
    <section class="audit-panel">
      <h2>{props.title}</h2>
      <Show when={props.sub}>{(sub) => <p class="audit-sub">{sub()}</p>}</Show>
      <Show when={props.pending}>
        {(pending) => (
          <p class="audit-sub">
            <Pending>{pending()}</Pending>
          </p>
        )}
      </Show>
      <Show when={props.legend}>
        {(legend) => (
          <div class="audit-legend">
            <For each={legend()}>
              {(entry) => (
                <span>
                  <i style={{ background: entry.colour }} />
                  {entry.label}
                </span>
              )}
            </For>
          </div>
        )}
      </Show>
      {props.children}
      <Show when={props.height}>{(height) => <div class="audit-sk-body" style={{ height: `${height()}px` }} />}</Show>
    </section>
  );
}
