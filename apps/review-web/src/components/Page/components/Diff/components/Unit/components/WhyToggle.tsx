import { Show } from "solid-js";

/** Opens and folds a unit's why: a sidebar icon, and on the head's toggle a word for it too. */
export function WhyToggle(props: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  class: string;
  label?: boolean;
}) {
  return (
    <button
      type="button"
      class={["why-toggle", props.class, { on: props.open }]}
      aria-expanded={props.open ? "true" : "false"}
      aria-controls={props.controls}
      aria-label={props.open ? "Hide why" : "Show why"}
      title={props.open ? "Hide why" : "Show why"}
      onClick={() => props.onToggle()}
    >
      <svg width="15" height="12" viewBox="0 0 15 12" aria-hidden="true">
        <rect
          x="0.75"
          y="0.75"
          width="13.5"
          height="10.5"
          rx="2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
        <rect
          x="9"
          y="1.5"
          width="4.5"
          height="9"
          fill="currentColor"
          opacity={props.open ? "0.9" : "0.25"}
        />
      </svg>
      <Show when={props.label}>{props.open ? "Hide why" : "Show why"}</Show>
    </button>
  );
}
