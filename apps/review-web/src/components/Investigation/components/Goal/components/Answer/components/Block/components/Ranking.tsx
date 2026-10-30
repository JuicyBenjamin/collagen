import { For } from "solid-js";

const FIT = {
  best: { word: "Best", badge: "badge-success" },
  good: { word: "Good", badge: "badge-info" },
  partial: { word: "Partial", badge: "badge-warning" },
  poor: { word: "Poor", badge: "badge-error" },
} as const;

/** Options best first: how well each fits, its name, and why. */
export function Ranking(props: { options: ReadonlyArray<{ readonly name: string; readonly fit: keyof typeof FIT; readonly why?: string }> }) {
  return (
    <ol class="inv-ranking">
      <For each={props.options}>
        {(option, index) => (
          <li>
            <span class="inv-number">{index() + 1}</span>
            <span class={["badge badge-sm badge-soft inv-mark", FIT[option.fit].badge]}>{FIT[option.fit].word}</span>
            <strong>{option.name}</strong>
            <span class="inv-why">{option.why}</span>
          </li>
        )}
      </For>
    </ol>
  );
}
