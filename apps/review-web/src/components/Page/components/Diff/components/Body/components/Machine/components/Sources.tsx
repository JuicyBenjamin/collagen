import { For } from "solid-js";
import { TOP } from "../stage";

/** Where what moves things comes from, stacked down the left, the one
 *  giving now lit. */
export function Sources(props: {
  sources: ReadonlyArray<{ readonly id: string; readonly name: string; readonly gives: string }>;
  giving?: string;
  width: number;
}) {
  return (
    <div class="machine-sources" style={{ top: `${TOP}px`, width: `${props.width}px` }}>
      <For each={props.sources}>
        {(source) => (
          <div class={{ "machine-source": true, lit: props.giving === source.id }}>
            <span class="machine-source-name">{source.name}</span>
            <span class="machine-source-gives">gives {source.gives}</span>
          </div>
        )}
      </For>
    </div>
  );
}
