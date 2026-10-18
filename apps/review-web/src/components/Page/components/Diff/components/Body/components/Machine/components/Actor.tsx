import { Show } from "solid-js";
import { columnLeft, columnWidth, HEAD, ROW, TOP, type Stage } from "../stage";

/** One thing running the machine, in the state it is in: lit while it
 *  moves, and naming what it waits on next. */
export function Actor(props: {
  name: string;
  column: number;
  row: number;
  stage: Stage;
  moving: boolean;
  needs?: string;
  asked: boolean;
}) {
  return (
    <div
      class={{ "machine-actor": true, moving: props.moving }}
      style={{
        left: `calc(${columnLeft(props.stage, props.column)} + 10px)`,
        width: `calc(${columnWidth(props.stage)} - 20px)`,
        top: `${TOP + HEAD + props.row * ROW}px`,
      }}
    >
      <span class="machine-actor-name">{props.name}</span>
      <Show when={props.needs}>
        {(needs) => <span class={{ "machine-needs": true, asked: props.asked }}>needs {needs()}</span>}
      </Show>
    </div>
  );
}
