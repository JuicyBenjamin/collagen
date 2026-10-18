import { Show } from "solid-js";

/** Before or after the change, when it changed a machine that was there;
 *  pausing, and playing it from the start. */
export function Controls(props: {
  changed: boolean;
  shown: "now" | "before";
  onShow: (shown: "now" | "before") => void;
  paused: boolean;
  onPause: () => void;
  onReplay: () => void;
}) {
  return (
    <div class="machine-controls">
      <Show when={props.changed}>
        <div class="machine-modes" role="group" aria-label="Before or after this change">
          <button type="button" class={{ on: props.shown === "before" }} onClick={() => props.onShow("before")}>
            Before
          </button>
          <button type="button" class={{ on: props.shown === "now" }} onClick={() => props.onShow("now")}>
            After
          </button>
        </div>
      </Show>
      <button type="button" class="machine-button" onClick={() => props.onPause()}>
        {props.paused ? "Play" : "Pause"}
      </button>
      <button type="button" class="machine-button" onClick={() => props.onReplay()}>
        Replay
      </button>
    </div>
  );
}
