import { For } from "solid-js";

export function Points(props: { items: ReadonlyArray<string> }) {
  return (
    <ul class="inv-points">
      <For each={props.items}>{(item) => <li>{item}</li>}</For>
    </ul>
  );
}
