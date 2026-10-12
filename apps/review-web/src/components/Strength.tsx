import { For, Show } from "solid-js";
import { STRENGTHS, type Strength } from "~/strength";

const hintOf = (strength: Strength) => STRENGTHS.find((option) => option.value === strength)?.hint ?? "";

/** How strongly a comment asks, beside who wrote it. */
export function StrengthMark(props: { strength: Strength | null }) {
  return <Show when={props.strength}>{(strength) => <span class={["strength-mark", strength()]} title={hintOf(strength())}>{strength()}</span>}</Show>;
}

/** Pick how strongly a comment asks — or none, a plain comment: picked
 *  again, a strength is let go. */
export function StrengthPicker(props: { value: Strength | null; onChange: (strength: Strength | null) => void }) {
  return (
    <div class="strengths" role="group" aria-label="How strongly it asks">
      <For each={STRENGTHS}>
        {(option) => (
          <button type="button" class={["strength-pick", option.value, { on: props.value === option.value }]} aria-pressed={props.value === option.value ? "true" : "false"} title={option.hint} onClick={() => props.onChange(props.value === option.value ? null : option.value)}>
            {option.value}
          </button>
        )}
      </For>
    </div>
  );
}
