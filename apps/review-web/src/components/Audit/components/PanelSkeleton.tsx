import { For } from "solid-js";
import { Masked } from "~/components/Masked";

/** A panel before its numbers are in: its title masked and its body a block
 *  the height the panel will have, so nothing below it moves when it lands. */
export function PanelSkeleton(props: { title: string; height: number; lines?: number }) {
  return (
    <section class="audit-panel">
      <h2>
        <Masked>{props.title}</Masked>
      </h2>
      <For each={Array.from({ length: props.lines ?? 0 })}>
        {() => (
          <p class="audit-sub">
            <Masked>Some words of the size</Masked>
          </p>
        )}
      </For>
      <div class="audit-sk-body" style={{ height: `${props.height}px` }} />
    </section>
  );
}
