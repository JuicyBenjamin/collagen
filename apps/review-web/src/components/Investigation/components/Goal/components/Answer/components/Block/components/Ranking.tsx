import { For } from "solid-js";

const FIT = { best: "badge-success", good: "badge-info", partial: "badge-warning", poor: "badge-error" } as const;

/** Options best first: how well each fits, its name, and why. */
export function Ranking(props: { options: ReadonlyArray<{ readonly name: string; readonly fit: keyof typeof FIT; readonly why?: string }> }) {
  return (
    <ol class="inv-ranking">
      <For each={props.options}>
        {(option, index) => (
          <li>
            <span class="inv-number">{index() + 1}</span>
            <span class={["badge badge-sm badge-soft inv-mark", FIT[option.fit]]}>{option.fit}</span>
            <strong>{option.name}</strong>
            <span class="inv-why">{option.why}</span>
          </li>
        )}
      </For>
    </ol>
  );
}
