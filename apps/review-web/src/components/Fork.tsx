import { Show } from "solid-js";
import type { Fork as ForkData } from "../data";
import { assumedNow } from "../assumedNow";

/** A fork in the road: what was chosen over what, why, and whose call — or,
 *  on a review built from assumptions, a turn the AI thinks was taken, and
 *  what that rests on. */
export function Fork(props: { fork: ForkData }) {
  return (
    <div class={["fork", { assumed: assumedNow.assumed() !== undefined }]} title={props.fork.at}>
      <p class="who">
        Fork in the road
        {assumedNow.assumed()
          ? ` · assumed${props.fork.confidence ? `, ${props.fork.confidence} confidence` : ""}`
          : props.fork.by
            ? ` · ${props.fork.by === "user" ? "the person's call" : "the agent's call"}`
            : ""}
      </p>
      <p>
        Chose <strong>{props.fork.chose}</strong> over {props.fork.instead}.
      </p>
      <p class="fork-why">{props.fork.why}</p>
      <Show when={assumedNow.assumed() && props.fork.basis}>
        <p class="fork-basis">Rests on: {props.fork.basis}</p>
      </Show>
    </div>
  );
}
