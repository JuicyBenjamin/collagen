import { For } from "solid-js";

/** Label and value, side by side. */
export function Facts(props: { rows: ReadonlyArray<{ readonly label: string; readonly value: string }> }) {
  return (
    <dl class="inv-table-facts">
      <For each={props.rows}>
        {(row) => (
          <>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </>
        )}
      </For>
    </dl>
  );
}
