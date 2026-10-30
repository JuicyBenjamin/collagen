import { For } from "solid-js";

const CALL = {
  adopt: { word: "Adopt", badge: "badge-success" },
  maybe: { word: "Maybe", badge: "badge-warning" },
  skip: { word: "Skip", badge: "badge-ghost" },
} as const;

/** Options, each with what to do about it, and why beneath. */
export function Choices(props: { options: ReadonlyArray<{ readonly name: string; readonly call: keyof typeof CALL; readonly why?: string }> }) {
  return (
    <ul class="inv-choices">
      <For each={props.options}>
        {(option) => (
          <li>
            <span class={["badge badge-sm badge-soft inv-mark", CALL[option.call].badge]}>{CALL[option.call].word}</span>
            <span>
              <strong>{option.name}</strong>
              {option.why && <span class="inv-why">{option.why}</span>}
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}
