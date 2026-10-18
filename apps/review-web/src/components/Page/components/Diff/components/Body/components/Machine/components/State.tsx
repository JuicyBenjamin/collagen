import { Show } from "solid-js";
import { columnLeft, columnWidth, TOP, type Stage } from "../stage";

/** One state's box: its name, what a person sees of a thing in it, and
 *  whether this change put it in or took it out. */
export function State(props: {
  state: { readonly name: string; readonly shows: string };
  column: number;
  stage: Stage;
  height: number;
  change?: "new" | "removed";
}) {
  return (
    <div
      class={{ "machine-state": true, removed: props.change === "removed" }}
      style={{ left: columnLeft(props.stage, props.column), width: columnWidth(props.stage), top: `${TOP}px`, height: `${props.height}px` }}
    >
      <span class="machine-state-name">
        {props.state.name}
        <Show when={props.change}>
          {(change) => <span class={`machine-tag ${change()}`}>{change() === "new" ? "new" : "removed"}</span>}
        </Show>
      </span>
      <span class="machine-state-shows">{props.state.shows}</span>
    </div>
  );
}
